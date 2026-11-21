// "Canales" (#canales): the policy's channel lists as three tier chip lists.
// Fixed rules applied before the model; the YouTube panel can pin channels too.
import { completeLists } from '../../channel-lists';
import { patchPolicy } from '../../policy-patch';
import { LABELS, type Label } from '../../types';
import { optionsApi, policyTransport } from '../api';
import { ChannelBoard } from '../components/channel-board';
import { viewHeader } from '../components/header';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { t } from '../i18n';
import { hrefFor } from '../router';
import { markPolicySaved } from '../setup-state';
import type { PolicyContent } from '../types';

export function renderChannels(): HTMLElement {
  const body = h('div', {}, spinner(t('common.loadingPolicy')));
  void load(body);
  return h('div', { className: 'view channels' }, viewHeader(t('channels.title'), t('channels.lead'), t('channels.eyebrow')), body);
}

function sameLists(a: Record<Label, string[]>, b: Record<Label, string[]>): boolean {
  return LABELS.every((l) => a[l].join('\n') === b[l].join('\n'));
}

async function load(body: HTMLElement): Promise<void> {
  const res = await optionsApi.getPolicy();
  if (!res.ok) {
    show(body, errorNotice(res.error, res.status, t('common.cannotReadPolicy')), button(t('common.retry'), () => void load(body)));
    return;
  }
  let saved = completeLists(res.data.content.channel_lists);
  const status = h('div', { className: 'status-slot' });
  const board = new ChannelBoard(saved, (lists) => {
    show(status, sameLists(lists, saved) ? null : h('p', { className: 'muted small', text: t('sites.dirty') }));
  });
  const next = h('a', { className: 'btn secondary', text: t('common.next'), attrs: { href: hrefFor('sites') } });
  const save = button(t('channels.save'), () => void withBusy(save, t('common.saving'), async () => {
    const wanted = board.getLists();
    const result = await patchPolicy(policyTransport, (content: PolicyContent) =>
      sameLists(completeLists(content.channel_lists), wanted) ? null : { ...content, channel_lists: wanted },
    );
    if (!result.ok) {
      show(status, errorNotice(result.error, result.status, t('common.cannotSave')));
      return;
    }
    saved = completeLists(result.data.content.channel_lists);
    board.setLists(saved);
    if (result.changed) await markPolicySaved();
    show(status, notice('ok', result.changed ? t('channels.saved', { version: result.data.version }) : t('sites.unchanged')));
  }), 'primary');
  body.replaceChildren(
    notice('info', t('channels.note')),
    board.element,
    h('div', { className: 'actions sticky' }, status, next, save),
  );
}

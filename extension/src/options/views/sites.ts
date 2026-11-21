// "Bloquear webs extra" (#webs), the step before launch: whole websites the
// extension blocks (and their subdomains), stored in the policy as
// `blocked_sites`. Saving also refreshes the background's cached list.
import { BLOCKED_SITES_KEY, normalizeDomain } from '../../sites';
import { optionsApi, policyTransport } from '../api';
import { ChipList } from '../components/chip-list';
import { viewHeader } from '../components/header';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { t } from '../i18n';
import { policyToForm, validateForm } from '../policy-form';
import { patchPolicy } from '../../policy-patch';
import { hrefFor } from '../router';
import { updateSetup } from '../setup-state';
import type { PolicyContent, PolicyOut } from '../types';

const ALL_SITES = { origins: ['<all_urls>'] };

export function renderSites(): HTMLElement {
  const body = h('div', {}, spinner(t('common.loadingPolicy')));
  void load(body);
  return h('div', { className: 'view sites' }, viewHeader(t('sites.title'), t('sites.lead'), t('sites.eyebrow')), body);
}

async function load(body: HTMLElement): Promise<void> {
  const res = await optionsApi.getPolicy();
  if (!res.ok) {
    show(body, errorNotice(res.error, res.status, t('common.cannotReadPolicy')), button(t('common.retry'), () => void load(body)));
    return;
  }
  new SitesEditor(body, res.data);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

class SitesEditor {
  private saved: string[];
  private sites: string[];
  private readonly chips: ChipList;
  private readonly status = h('div', { className: 'status-slot' });
  private readonly permission = h('div');

  constructor(body: HTMLElement, private policy: PolicyOut) {
    this.saved = [...(policy.content.blocked_sites ?? [])];
    this.sites = [...this.saved];
    this.chips = new ChipList({
      inputLabel: t('sites.inputLabel'),
      placeholder: t('sites.placeholder'),
      addLabel: t('common.add'),
      emptyText: t('sites.none'),
      separator: /[\s,;]+/,
      add: (raw) => this.add(raw),
      className: 'sites-chips',
    });
    const save = button(t('sites.save'), () => void withBusy(save, t('common.saving'), () => this.confirm()), 'primary');
    body.replaceChildren(this.permission, this.chips.element, h('div', { className: 'actions sticky' }, this.status, save));
    this.render();
    void this.checkPermission();
  }

  private add(raw: string): string | null {
    const result = normalizeDomain(raw);
    if (!result.ok) {
      if (result.error === 'empty') return t('sites.error.empty');
      if (result.error === 'protected') return t('sites.error.protected');
      return t('sites.error.invalid', { value: raw });
    }
    if (this.sites.includes(result.domain)) return t('sites.error.duplicate', { domain: result.domain });
    this.sites.push(result.domain);
    this.render();
    return null;
  }

  private render(): void {
    this.chips.render(
      this.sites.map((domain) => ({
        value: domain,
        removeLabel: t('sites.remove', { domain }),
        onRemove: () => {
          this.sites = this.sites.filter((d) => d !== domain);
          this.render();
        },
      })),
    );
    const dirty = !sameList(this.sites, this.saved);
    show(this.status, dirty ? h('p', { className: 'muted small', text: t('sites.dirty') }) : null);
  }

  /** Saves when the list changed, then marks the step as reviewed. */
  private async confirm(): Promise<void> {
    const wanted = [...this.sites];
    const res = await patchPolicy(policyTransport, (content: PolicyContent) =>
      sameList(content.blocked_sites ?? [], wanted) ? null : { ...content, blocked_sites: wanted },
    );
    if (!res.ok) {
      show(this.status, errorNotice(res.error, res.status, t('common.cannotSave')));
      return;
    }
    this.policy = res.data;
    this.saved = [...(res.data.content.blocked_sites ?? [])];
    this.sites = [...this.saved];
    await browser.storage.local.set({ [BLOCKED_SITES_KEY]: this.saved }).catch(() => undefined);
    const valid = validateForm(policyToForm(res.data.content)).length === 0;
    await updateSetup((s) => ({ ...s, sitesReviewed: true, policySaved: s.policySaved || res.changed === true || valid }));
    this.render();
    show(
      this.status,
      notice(
        'ok',
        h('strong', { text: res.changed ? t('sites.saved', { version: res.data.version }) : t('sites.unchanged') }),
        h('p', { text: t('sites.ready') }),
        h('a', { className: 'btn primary', text: t('sites.toLaunch'), attrs: { href: hrefFor('landing') } }),
      ),
    );
  }

  private async checkPermission(): Promise<void> {
    let granted = true;
    try {
      granted = await browser.permissions.contains(ALL_SITES);
    } catch {
      return; // API unavailable: nothing to offer
    }
    if (granted) return show(this.permission);
    const grant = button(t('sites.grant'), () => {
      void browser.permissions.request(ALL_SITES).then((ok) => ok && show(this.permission));
    }, 'primary');
    show(this.permission, notice('warn', h('p', { text: t('sites.permission') }), grant));
  }
}

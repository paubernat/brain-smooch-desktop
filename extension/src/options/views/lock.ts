// "Lock" (#candado): unlock with the custodian's password and the protection
// settings that need it to be relaxed. Linked from every "needs the password"
// notice.
import { viewHeader } from '../components/header';
import { h } from '../dom';
import { t } from '../i18n';
import { LockCard } from './lock-card';
import { ProtectionCard } from './protection-card';

export function renderLock(): HTMLElement {
  return h('div', { className: 'view lock tools' }, viewHeader(t('lock.title'), t('lock.viewLead'), t('lock.eyebrow')), new LockCard().element, new ProtectionCard().element);
}

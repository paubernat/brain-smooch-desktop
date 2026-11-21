// EN / ES / CA toggle (radio group), shown on every screen of the page.
import { h } from '../dom';
import { LANG_NAMES, LANGS, currentLang, setLang, t, type Lang } from '../i18n';

export function langSwitch(): HTMLElement {
  const group = h('div', { className: 'lang-switch', attrs: { role: 'radiogroup' } });
  const buttons = new Map<Lang, HTMLButtonElement>();
  const sync = () => {
    group.setAttribute('aria-label', t('lang.label'));
    for (const [lang, b] of buttons) {
      const on = lang === currentLang();
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  for (const lang of LANGS) {
    const b = h('button', { className: 'lang-option', text: lang.toUpperCase(), attrs: { type: 'button', role: 'radio', lang, title: LANG_NAMES[lang] } });
    b.addEventListener('click', () => setLang(lang));
    b.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = LANGS[(LANGS.indexOf(lang) + step + LANGS.length) % LANGS.length] ?? lang;
      setLang(next);
      buttons.get(next)?.focus();
    });
    buttons.set(lang, b);
    group.append(b);
  }
  sync(); // the whole page re-renders on a language change
  return group;
}

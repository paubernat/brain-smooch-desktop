// Pure display helpers in the UI language (Spanish and Catalan: "76 %",
// "1,50 $"; English: "76%", "$1.50").
import { currentLang, currentLocale, t } from './i18n';

function decimal(text: string): string {
  return currentLang() === 'en' ? text : text.replace('.', ',');
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const n = decimal((value * 100).toFixed(digits));
  return currentLang() === 'en' ? `${n}%` : `${n} %`;
}

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const digits = value === 0 ? 0 : value < 0.01 ? 4 : 2;
  const n = decimal(value.toFixed(digits));
  return currentLang() === 'en' ? `$${n}` : `${n} $`;
}

export function pricePerMtok(input: number | null): string {
  return input === null ? t('format.priceUnknown') : t('format.perMtok', { price: usd(input) });
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

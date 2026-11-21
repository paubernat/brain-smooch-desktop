// Pure display helpers (Spanish locale).

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits).replace('.', ',')} %`;
}

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return '0 $';
  const digits = value < 0.01 ? 4 : 2;
  return `${value.toFixed(digits).replace('.', ',')} $`;
}

export function pricePerMtok(input: number | null): string {
  return input === null ? 'precio desconocido' : `${usd(input)}/M tokens`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

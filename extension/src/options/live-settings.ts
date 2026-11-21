// Pure helpers for the "Juez en directo" card (unit-tested).
import type { LiveSettings } from '../types';
import { t, type MessageKey } from './i18n';
import type { JudgesOut } from './types';

const CONFIG_KEYS: Readonly<Record<string, MessageKey>> = {
  A: 'live.config.A',
  B: 'live.config.B',
  C: 'live.config.C',
  D: 'live.config.D',
  E: 'live.config.E',
  F: 'live.config.F',
};

export function describeConfig(id: string, levels: string): string {
  const key = CONFIG_KEYS[id];
  return key ? `${id} · ${t(key)}` : `${id} · ${levels}`;
}

/** Warning when the saved judge cannot run (missing API key or unknown to the service). */
export function judgeWarning(settings: LiveSettings, judges: JudgesOut): string | null {
  const judge = judges.judges.find((j) => j.key === settings.judge);
  if (!judge) return t('live.judgeMissing', { judge: settings.judge });
  if (!judge.key_configured) return t('live.keyMissing', { env: judge.key_env });
  return null;
}

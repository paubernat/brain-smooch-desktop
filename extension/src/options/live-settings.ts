// Pure helpers for the "Juez en directo" card (unit-tested).
import type { LiveSettings } from '../types';
import type { JudgesOut } from './types';

export const CONFIG_DESCRIPTIONS: Record<string, string> = {
  A: 'solo metadatos (título, descripción, etiquetas)',
  B: 'metadatos + canal',
  C: 'metadatos + transcripción',
  D: 'metadatos + canal + transcripción (recomendada)',
  E: 'todo: también fotogramas (más caro y lento)',
  F: 'metadatos + fotogramas',
};

export const REVEAL_EXPLANATION =
  'Si ves el veredicto antes de etiquetar, ese vídeo no cuenta para medir al modelo.';

export function describeConfig(id: string, levels: string): string {
  const text = CONFIG_DESCRIPTIONS[id];
  return text ? `${id} · ${text}` : `${id} · ${levels}`;
}

/** Warning when the saved judge cannot run (missing API key or unknown to the service). */
export function judgeWarning(settings: LiveSettings, judges: JudgesOut): string | null {
  const judge = judges.judges.find((j) => j.key === settings.judge);
  if (!judge) return `El juez ${settings.judge} no está disponible en el servicio.`;
  if (!judge.key_configured) return `Falta ${judge.key_env} en el .env de la raíz: el panel mostrará un error hasta que la añadas y reinicies el servicio.`;
  return null;
}

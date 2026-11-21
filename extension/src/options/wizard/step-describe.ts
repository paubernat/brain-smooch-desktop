// Step 1: the user describes, in their own words, what goes in each tier.
import { optionsApi } from '../api';
import { tierHeader } from '../components/policy-editor';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, textarea } from '../dom';
import type { TierTexts } from '../types';
import type { WizardContext } from './context';
import { hasPreferences, withDraft } from './state';

interface TierPrompt {
  key: keyof TierTexts;
  label: 'LIBRE' | 'LIMITADO' | 'NO';
  title: string;
  placeholder: string;
}

const TIERS: readonly TierPrompt[] = [
  {
    key: 'libre',
    label: 'LIBRE',
    title: 'Sí, sin límite',
    placeholder: 'Piano jazz con los acordes en pantalla, explicaciones de armonía, tutoriales de Azure, arquitectura de software, Fireship…',
  },
  {
    key: 'limitado',
    label: 'LIMITADO',
    title: 'Con cupo de tiempo',
    placeholder: 'Atrioc, dunkey, Ludwig… entretenimiento de creadores que me gustan, media hora al día.',
  },
  {
    key: 'no',
    label: 'NO',
    title: 'Nada',
    placeholder: 'League of Legends, NBA, Shorts de relleno, slop de IA, listas sensacionalistas…',
  },
];

export function renderDescribe(ctx: WizardContext): HTMLElement {
  const prefs = ctx.state.preferences;
  const status = h('div', { className: 'status-slot' });
  const persist = () => ctx.update({ ...ctx.state, preferences: prefs });

  const cards = TIERS.map((t) => {
    const examples = h(
      'details',
      { className: 'examples' },
      h('summary', { text: 'Vídeos de ejemplo (opcional)' }),
      textarea(prefs.examples[t.key], 'Un título o URL por línea', 3, (v) => {
        prefs.examples[t.key] = v;
        persist();
      }),
    );
    if (prefs.examples[t.key].trim()) examples.open = true;
    return h(
      'section',
      { className: `tier-card tier-${t.label}` },
      tierHeader(t.label, t.title),
      textarea(prefs[t.key], t.placeholder, 7, (v) => {
        prefs[t.key] = v;
        persist();
      }),
      examples,
    );
  });

  const generate = button('Generar borrador con IA', () => void draft(), 'primary');
  async function draft(): Promise<void> {
    if (!hasPreferences(prefs)) {
      show(status, notice('warn', 'Escribe algo en al menos una de las tres categorías.'));
      return;
    }
    generate.disabled = true;
    show(status, spinner('Claude está redactando tu política… suele tardar menos de un minuto.'));
    const res = await optionsApi.draft(prefs);
    generate.disabled = false;
    if (!res.ok) {
      show(status, errorNotice(res.error, res.status, 'No se pudo generar el borrador'));
      return;
    }
    const next = withDraft(ctx.state, res.data.content);
    ctx.update({ ...next, rationale: res.data.rationale, changelog: [] });
    ctx.goto('draft');
  }

  return h(
    'div',
    { className: 'step describe' },
    h('p', { className: 'lead', text: 'Escribe con tus palabras qué quieres ver en cada categoría. No hace falta ser preciso: la IA lo convierte en una política y luego la afinamos con tus etiquetas.' }),
    h('div', { className: 'tier-grid' }, ...cards),
    h(
      'div',
      { className: 'actions' },
      status,
      ctx.state.draft ? button('Ir al borrador actual →', () => ctx.goto('draft'), 'ghost') : null,
      generate,
    ),
  );
}

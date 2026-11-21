// Launching the system (the rocket): animation, blocking on in Firefox
// (`enforcement.mode = "soft"`, a tightening: no password needed) and the
// local "launched" flag that turns the landing into the dashboard.
import { optionsApi } from './api';
import { playLaunch } from './components/launch';
import { updateSetup } from './setup-state';

export async function launchSystem(): Promise<{ ok: boolean; error?: string; status?: number | null }> {
  await playLaunch();
  const current = await optionsApi.enforcement();
  if (!current.ok) return { ok: false, error: current.error, status: current.status };
  if (current.data.mode !== 'soft') {
    const saved = await optionsApi.saveEnforcement({ ...current.data, mode: 'soft' });
    if (!saved.ok) return { ok: false, error: saved.error, status: saved.status };
  }
  await updateSetup((s) => ({ ...s, launched: true }));
  return { ok: true };
}

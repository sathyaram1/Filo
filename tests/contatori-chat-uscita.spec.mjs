// I contatori della chat (#1463) quando Filo si chiude: la chat lasciata aperta si conta come «uscita» (dal menu o
// chiudendo la finestra), come «appesa_all_avvio» solo dopo un crash, e i conti degli ultimi secondi non si perdono.
// Gli altri conti della chat: tests/contatori-chat.spec.mjs.
import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { home, chiedi, modelloFinto } from './helpers/chatFinta.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function lancia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'], cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  return app;
}

// Le chat finite per via, sommate fra le ore e quelle che aspettano il tipo; i turni della chat.
const contatori = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const vie = {};
  const turni = {};
  for (const o of Object.values(s.ore || {})) {
    for (const [via, v] of Object.entries(o.chatChiuse || {})) for (const n of Object.values(v)) vie[via] = (vie[via] || 0) + n;
    for (const [k, n] of Object.entries((o.chatTurni || {})['filo-chat'] || {})) turni[k] = (turni[k] || 0) + n;
  }
  for (const c of Object.values(s.chiuse || {})) vie[c.via] = (vie[c.via] || 0) + 1;
  return { vie, turni, uscite: Object.keys(s.uscite || {}).length };
});

async function unaRisposta(app) {
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Fatto.' }]);
  await chiedi(page, 'una domanda');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await contatori(app)).turni['risposta|g1'] || 0, { timeout: 8_000 }).toBe(1);
}

async function conCartella(fn) {
  const userData = cartellaTemporanea('contatori-uscita-');
  const aperte = [];
  try {
    await fn(async () => { const a = await lancia(userData); aperte.push(a); return a; });
  } finally {
    for (const a of aperte) await chiudiApp(a);
    rmSync(userData, { recursive: true, force: true });
  }
}

const chiudiFinestre = (app) => app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.close(); });
const uscitaChiusa = (app) => new Promise((ok) => { app.process().once('exit', ok); });

for (const [come, chiudi] of [
  ['uscendo da Filo', (app) => chiudiApp(app, { tetto: 15_000 })],
  ['chiudendo la finestra', async (app) => { const fatto = uscitaChiusa(app); await chiudiFinestre(app); await Promise.race([fatto, new Promise((ok) => setTimeout(ok, 15_000))]); await chiudiApp(app); }],
]) {
  test(`una chat aperta ${come} si conta una volta, come uscita, e il turno appena contato resta`, async () => {
    test.setTimeout(120_000);
    await conCartella(async (avvia) => {
      const prima = await avvia();
      await unaRisposta(prima);
      // Subito: il conto del turno aspettava ancora il salvataggio.
      await chiudi(prima);
      const dopo = await avvia();
      await home(dopo);
      await expect.poll(async () => (await contatori(dopo)).vie, { timeout: 30_000 }).toEqual({ uscita: 1 });
      const c = await contatori(dopo);
      expect(c.turni).toEqual({ 'risposta|g1': 1 });
      expect(c.uscite, 'nessun segno resta in sospeso').toBe(0);
      // La chat ha preso la sua chiusura, e non si conta una seconda volta a un altro avvio.
      expect(await dopo.evaluate(async () => (await globalThis.SN_FILO_CHATS.listDangling()).length)).toBe(0);
      await chiudiApp(dopo, { tetto: 15_000 });
      const ancora = await avvia();
      await home(ancora);
      await new Promise((ok) => setTimeout(ok, 2_000));
      expect((await contatori(ancora)).vie).toEqual({ uscita: 1 });
    });
  });
}

test('una chat rimasta aperta per un crash si conta come appesa all’avvio dopo', async () => {
  test.setTimeout(120_000);
  await conCartella(async (avvia) => {
    const prima = await avvia();
    await unaRisposta(prima);
    // Il conto del turno sul disco, poi Filo muore senza chiudersi.
    await prima.evaluate(() => globalThis.SN_CONTATORI_MAIN.salva());
    const pid = prima.process().pid;
    const morto = uscitaChiusa(prima);
    try { process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL'); } catch (_) { process.kill(pid, 'SIGKILL'); }
    await morto;
    const dopo = await avvia();
    await home(dopo);
    await expect.poll(async () => (await contatori(dopo)).vie, { timeout: 30_000 }).toEqual({ appesa_all_avvio: 1 });
  });
});

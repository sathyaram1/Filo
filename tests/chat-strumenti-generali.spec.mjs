// #1564 — la chat lavora con gli strumenti generali (SPEC-CONTESTO § Gli strumenti): la richiesta porta la decina di
// strumenti uguali per tutti, e strumento(azione) arriva agli stessi gestori di prima. I cammini principali: impostare
// una preferenza, aprire una scheda, cercare nel filo e rileggerne il grezzo, un'azione con conferma. Modello finto.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';

// Gli strumenti che ogni chiamata della chat ha portato al fornitore, per nome.
async function contaStrumenti(app) {
  await app.evaluate(() => {
    const prima = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__strumentiMandati = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      globalThis.__strumentiMandati.push((o.tools || []).map((t) => t.function.name));
      return prima(o);
    };
  });
}
const strumentiMandati = (app) => app.evaluate(() => globalThis.__strumentiMandati || []);
const ultimaStoria = async (app) => { const c = await chiamateAlModello(app); return JSON.stringify(c[c.length - 1]); };

test('impostazioni(imposta) cambia la preferenza come prima, e la richiesta porta solo gli strumenti generali', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'light' }));
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p1', name: 'impostazioni', arguments: JSON.stringify({ azione: 'imposta', chiave: 'tema', valore: 'scuro' }) }] },
    { text: 'Fatto, tema scuro.' },
  ]);
  await contaStrumenti(app);
  await chiedi(page, 'metti il tema scuro');
  await expect.poll(() => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => s.theme)), { timeout: 10_000 }).toBe('dark');
  const mandati = await strumentiMandati(app);
  expect(mandati[0]).toEqual(['impostazioni', 'scheda', 'home', 'promemoria', 'file', 'computer', 'web', 'memoria', 'filo', 'filo_su_di_se']);
  await page.screenshot({ path: 'tests/.shots/chat-strumenti-generali-tema.png' });
  await ripristina(app);
});

test('scheda(apri) apre la pagina in una scheda nuova', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const url = testServer.html('<title>Posta</title><h1>Posta</h1>');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'n1', name: 'scheda', arguments: JSON.stringify({ azione: 'apri', url }) }] },
    { text: 'Aperta.' },
  ]);
  await chiedi(page, 'apri la posta');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  await ripristina(app);
});

test('filo(cerca) ritrova una conversazione di prima e filo(espandi) ne rende il grezzo al modello', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Le orche vivono in tutti gli oceani.' }]);
  await chiedi(page, 'dove vivono le orche marine?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'tutti gli oceani' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const da = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'filo', arguments: JSON.stringify({ azione: 'cerca', query: 'orche marine' }) }] },
    { toolCalls: [{ id: 'e1', name: 'filo', arguments: JSON.stringify({ azione: 'espandi', da }) }] },
    { text: 'Ne avevamo parlato poco fa.' },
  ]);
  await chiedi(page, 'di cosa avevamo parlato?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ne avevamo parlato poco fa' })).toBeVisible({ timeout: 15_000 });
  const chiamate = await chiamateAlModello(app);
  const dopoCerca = JSON.stringify(chiamate[chiamate.length - 2]);
  expect(dopoCerca, 'la ricerca torna al modello con la conversazione che combacia').toMatch(/orche marine/);
  const dopoEspandi = await ultimaStoria(app);
  expect(dopoEspandi, 'il grezzo di quelle ore, coi messaggi com\'erano').toContain('Il filo di quelle ore');
  expect(dopoEspandi).toMatch(/utente nella chat[^"]*dove vivono le orche marine\?/);
  expect(dopoEspandi).toContain('Le orche vivono in tutti gli oceani.');
  await ripristina(app);
});

test('filo_su_di_se(feedback) a Conservativo apre la conferma, e uno strumento senza azione torna al modello con l\'errore', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'filo_su_di_se', arguments: JSON.stringify({ azione: 'feedback', testo: 'Il timer non suona.', titolo: 'Timer muto' }) }] },
    { text: 'Ho preparato la segnalazione.' },
  ]);
  await chiedi(page, 'segnala che il timer non suona');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(CONFIRM_HOST)).toContainText('Il timer non suona.');
  await page.screenshot({ path: 'tests/.shots/chat-strumenti-generali-conferma.png' });
  await clickConfirm(page, 'cancel');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });

  await modelloFinto(app, [
    { toolCalls: [{ id: 'x1', name: 'scheda', arguments: JSON.stringify({ url: 'https://example.com' }) }] },
    { text: 'Riprovo.' },
  ]);
  await chiedi(page, 'apri example');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(2);
  expect(await ultimaStoria(app)).toMatch(/manca l'azione in scheda: scegli fra apri/);
  await ripristina(app);
});

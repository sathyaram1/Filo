// #1403 — L0: premuto Invia il riquadro si chiude e un avviso dice che il feedback parte; un modello finto lo rilegge.
// Trovato qualcosa, il riquadro si riapre col testo intatto, le parti evidenziate e «Correggi» / «Manda così»; senza
// risposta entro 8 secondi parte lo stesso; con Filo chiuso a metà parte alla riapertura. Finti: modello e rete.

import { test, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron, test as testSenzaFixture } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { nelMondoDiFilo, statoDi, clicca, paginaDelloStrato } from './helpers/riquadri.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = 'tests/.shots';

async function newtab(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

// Nel main: il modello risponde quello che la prova scrive in `__l0` (testo o immagini), dopo `ritardo` ms; la rete
// del feedback accetta tutto e tiene i payload.
async function finti(app) {
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { ...T.models }, modelRegistry: T.registry,
    });
    globalThis.__l0 = { testo: '{"trovati":[]}', immagini: '{"trovati":[]}', ritardo: 0, chiamate: [] };
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: `fb-${globalThis.__invii.length}`, seq: 1, failed: [] }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, signal }) => {
      const S = globalThis.__l0;
      const sys = String(messages?.[0]?.content || '');
      const cosa = sys.startsWith('Rileggi un feedback') ? 'testo' : sys.startsWith('Guarda le immagini') ? 'immagini' : 'altro';
      S.chiamate.push(cosa);
      if (cosa === 'altro') return { text: 'Titolo', provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {} };
      if (S.ritardo) {
        await new Promise((r, rej) => {
          const t = setTimeout(r, S.ritardo);
          signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(Object.assign(new Error('interrotta'), { name: 'AbortError' })); });
        });
      }
      return { text: S[cosa], provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: { promptTokens: 1500, completionTokens: 40 } };
    };
  });
}
const imposta = (app, v) => app.evaluate((_e, v) => Object.assign(globalThis.__l0, v), v);
const chiamateTesto = (app) => app.evaluate(() => globalThis.__l0.chiamate.filter((c) => c === 'testo').length);
const invii = (app) => app.evaluate(() => globalThis.__invii.map((p) => p.text));
const toast = (page, testo) => page.locator('.sn-toast').filter({ hasText: testo });

const PASSWORD = 'Gatto!2024';
const TESTO = `Non riesco a entrare nel sito della banca. La mia password è ${PASSWORD} e mi dice che è sbagliata.`;

async function scriviEInvia(page, testo) {
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await page.locator('.sn-fb-text').fill(testo);
  await page.locator('.sn-fb-send').click();
}

test('trovata una password: il riquadro si chiude, si riapre con l\'avviso e la parte evidenziata, e «Manda così» la manda', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { ritardo: 1500, testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: PASSWORD }] }) });

  await scriviEInvia(page, TESTO);
  // Il riquadro si chiude subito e l'avviso in basso dice che il feedback sta partendo.
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 1_000 });
  await expect(toast(page, 'Sto inviando il feedback')).toHaveCount(1);

  // Si riapre col testo intatto, l'avviso sopra e la password evidenziata.
  const avviso = page.locator('.sn-fb-l0');
  await expect(avviso).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.sn-fb-text')).toHaveValue(TESTO);
  await expect(avviso).toContainText('password');
  await expect(page.locator('.sn-fb-evidenze mark')).toHaveText([PASSWORD]);
  await expect(avviso.locator('.sn-fb-l0-correggi')).toHaveText('Correggi');
  await expect(avviso.locator('.sn-fb-l0-manda')).toHaveText('Manda così');
  expect(await avviso.innerText(), 'nessun punteggio né cifra nell\'avviso').not.toMatch(/\d|%/);
  await expect(toast(page, 'Sto inviando il feedback')).toHaveCount(0);
  expect(await invii(app), 'non è partito niente').toEqual([]);
  expect(await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.size()), 'e non resta in coda').toBe(0);
  await page.screenshot({ path: `${SHOTS}/1403-avviso-chiaro.png` });
  await page.evaluate(() => { for (const el of document.querySelectorAll('[data-sn-theme], .sn-fb-overlay')) el.dataset.snTheme = 'dark'; document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: `${SHOTS}/1403-avviso-scuro.png` });

  // «Manda così»: parte com'è, senza una seconda rilettura.
  const prima = await chiamateTesto(app);
  await avviso.locator('.sn-fb-l0-manda').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1, { timeout: 15_000 });
  expect(await invii(app)).toEqual([TESTO]);
  expect(await chiamateTesto(app)).toBe(prima);
});

test('su un sito il riquadro sta sopra la scheda: chiuso all\'invio, si riapre lì con l\'avviso e l\'immagine segnata', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><body style="padding:40px"><h1>Un sito</h1></body>');
  await finti(app);
  await imposta(app, {
    testo: JSON.stringify({ trovati: [{ tipo: 'persone', pezzo: 'Mario Bianchi, 333 1234567' }] }),
    immagini: JSON.stringify({ trovati: [{ tipo: 'schede', immagine: 1 }] }),
  });
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  expect((await statoDi(app, p, '.sn-fb-text')).nelloStrato).toBe(true);
  const strato = await paginaDelloStrato(app, p);
  const TESTO_SITO = 'Il modulo non salva. Il mio vicino Mario Bianchi, 333 1234567, ha lo stesso problema.';
  await strato.locator('.sn-fb-text').fill(TESTO_SITO);
  await strato.locator('.sn-fb-file').setInputFiles([{ name: 'schermo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }]);
  await expect(strato.locator('.sn-fb-thumb')).toHaveCount(1);
  await clicca(app, p, '.sn-fb-send');
  await expect.poll(() => statoDi(app, p, '.sn-fb-l0'), { timeout: 10_000 }).not.toBeNull();
  await expect(strato.locator('.sn-fb-l0')).toBeVisible();
  await expect(strato.locator('.sn-fb-l0')).toContainText('un’altra persona');
  await expect(strato.locator('.sn-fb-l0')).toContainText('altre schede');
  await expect(strato.locator('.sn-fb-text')).toHaveValue(TESTO_SITO);
  await expect(strato.locator('.sn-fb-evidenze mark')).toHaveText(['Mario Bianchi, 333 1234567']);
  await expect(strato.locator('.sn-fb-thumb.sn-fb-thumb--l0')).toHaveCount(1);
  expect(await invii(app)).toEqual([]);
  // L'immagine segnata si toglie, e il feedback riletto parte senza.
  await strato.locator('.sn-fb-thumb-x').click();
  await imposta(app, { testo: '{"trovati":[]}', immagini: '{"trovati":[]}' });
  await strato.locator('.sn-fb-text').fill('Il modulo non salva.');
  await clicca(app, p, '.sn-fb-send');
  await expect.poll(() => invii(app), { timeout: 15_000 }).toEqual(['Il modulo non salva.']);
  expect(await app.evaluate(() => globalThis.__invii[0].images.length)).toBe(0);
});

test('«Correggi» porta sulla parte segnata; corretta, l\'evidenza sparisce e il feedback parte riletto', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: PASSWORD }] }) });

  await scriviEInvia(page, TESTO);
  await expect(page.locator('.sn-fb-l0')).toBeVisible({ timeout: 10_000 });
  await page.locator('.sn-fb-l0-correggi').click();
  await expect(page.locator('.sn-fb-l0')).toBeHidden();
  const sel = await page.locator('.sn-fb-text').evaluate((t) => t.value.slice(t.selectionStart, t.selectionEnd));
  expect(sel, 'la password è selezionata, pronta da riscrivere').toBe(PASSWORD);
  await page.keyboard.type('(tolta)');
  await expect(page.locator('.sn-fb-evidenze mark')).toHaveCount(0);

  await imposta(app, { testo: '{"trovati":[]}' });
  await page.locator('.sn-fb-send').click();
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1, { timeout: 15_000 });
  expect(await invii(app)).toEqual([TESTO.replace(PASSWORD, '(tolta)')]);
});

test('la rilettura parte mentre si scrive: all\'invio, testo uguale, non si rilegge', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').click();
  await page.keyboard.type('Il tasto Salva non risponde');
  await expect.poll(() => chiamateTesto(app), { timeout: 6_000 }).toBe(1);
  await page.locator('.sn-fb-send').click();
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1, { timeout: 15_000 });
  expect(await chiamateTesto(app), 'riletto una volta sola').toBe(1);
  expect(await invii(app)).toEqual(['Il tasto Salva non risponde']);
});

test('il modello non risponde: dopo 8 secondi il feedback parte lo stesso', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { ritardo: 60_000 });
  const t0 = Date.now();
  await scriviEInvia(page, 'La barra sparisce a schermo intero');
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 1_000 });
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1, { timeout: 20_000 });
  const dopo = Date.now() - t0;
  expect(dopo).toBeGreaterThan(7_500);
  expect(dopo).toBeLessThan(18_000);
  expect(await invii(app)).toEqual(['La barra sparisce a schermo intero']);
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
});

testSenzaFixture('Filo chiuso durante la rilettura: il feedback resta salvato e parte alla riapertura', async () => {
  testSenzaFixture.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-l0-riavvio-');
  const avvia = async () => {
    const app = await electron.launch({ args: [...argomentiScala, '.'], cwd: APP_ROOT, env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' } });
    const shell = await primaFinestra(app);
    await shell.waitForLoadState('domcontentloaded');
    return app;
  };
  try {
    let app = await avvia();
    const page = await newtab(app);
    await finti(app);
    await imposta(app, { ritardo: 60_000 });
    await scriviEInvia(page, 'Resta anche se chiudo Filo');
    await expect.poll(() => app.evaluate(() => globalThis.__l0.chiamate.includes('testo')), { timeout: 5_000 }).toBe(true);
    expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getRaw('feedbackOutbox', [])).map((x) => x.payload.text)))
      .toEqual(['Resta anche se chiudo Filo']);
    expect(await invii(app)).toEqual([]);
    await chiudiApp(app);

    app = await avvia();
    await app.evaluate(() => {
      globalThis.__invii = [];
      globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: 'fb-1', seq: 1, failed: [] }; };
    });
    await expect.poll(async () => {
      await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.flush());
      return invii(app);
    }, { timeout: 30_000 }).toEqual(['Resta anche se chiudo Filo']);
    await chiudiApp(app);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

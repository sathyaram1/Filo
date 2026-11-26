// #1403 — L0: premuto Invia il riquadro si chiude e un avviso dice che il feedback parte; un modello finto lo rilegge.
// Trovato qualcosa, il riquadro si riapre col testo intatto, le parti evidenziate e «Correggi» / «Manda così»; senza
// risposta entro 8 secondi parte lo stesso; con Filo chiuso a metà parte alla riapertura. Finti: modello e rete.

import { test, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron, test as testSenzaFixture } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { nelMondoDiFilo, statoDi, clicca, paginaDelloStrato } from './helpers/riquadri.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm, fillConfirmInput, scrollConfirmToEnd, aspettaConfermaPronta } from './helpers/confirm.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';

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

test('spenta in Preferenze avanzate (con la stima accanto) o chiedendolo a Filo, il feedback parte senza rilettura', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await finti(app);
  await imposta(app, { testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: PASSWORD }] }) });
  const pref = await openTab('filo://preferences/preferences.html#sec-feedback');
  const casella = pref.locator('#feedbackRilettura');
  await expect(casella).toBeChecked();
  await expect(pref.locator('#sec-feedback')).toContainText('al mese');
  await casella.uncheck();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).feedbackRilettura?.enabled)).toBe(false);
  await pref.locator('#sec-feedback').screenshot({ path: `${SHOTS}/1403-preferenze.png` });

  const page = await newtab(app);
  await scriviEInvia(page, TESTO);
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1, { timeout: 15_000 });
  expect(await invii(app)).toEqual([TESTO]);
  expect(await chiamateTesto(app), 'nessuna rilettura').toBe(0);

  // La stessa scelta dalla chat la scrive nello stesso posto.
  const P = await app.evaluate(() => globalThis.SN_PREF.buildPreferencePartial('rilettura_feedback', 'sì').partial);
  expect(P).toEqual({ feedbackRilettura: { enabled: true } });
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

// #1403.1 — gli allegati di testo li rilegge il controllo senza modello.
test('un log allegato con una password: il riquadro si riapre con l\'avviso e il file segnato, «Manda così» lo manda', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { ritardo: 1_500 });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Allego il log: il login fallisce sempre.');
  const log = 'avvio...\nutente = mario.rossi\npassword = hunter22\nerrore 401\n';
  await page.locator('.sn-fb-file').setInputFiles([
    { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('niente di strano qui') },
    { name: 'filo.log', mimeType: 'text/plain', buffer: Buffer.from(log) },
  ]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(2);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 1_000 });

  const avviso = page.locator('.sn-fb-l0');
  await expect(avviso).toBeVisible({ timeout: 12_000 });
  await expect(avviso).toContainText('In un file allegato c’è una password');
  await expect(page.locator('.sn-fb-file-chip--l0')).toHaveCount(1);
  await expect(page.locator('.sn-fb-file-chip--l0')).toContainText('filo.log');
  expect(await invii(app)).toEqual([]);
  expect(await app.evaluate(() => JSON.stringify(globalThis.__l0)).then((s) => s.includes('hunter22')), 'il log non va a nessun modello').toBe(false);
  await page.locator('.sn-fb-modal').screenshot({ path: `${SHOTS}/1403.1-allegato.png` });

  await avviso.locator('.sn-fb-l0-manda').click();
  await expect(toast(page, 'Grazie! Feedback inviato.')).toHaveCount(1, { timeout: 15_000 });
  expect(await app.evaluate(() => globalThis.__invii.map((p) => (p.files || []).map((f) => f.name)))).toEqual([['note.txt', 'filo.log']]);
});

// #1403.2 — la colonna «password» di un CSV, nel formato normale, dà l'avviso come quella a tabulazioni.
test('un CSV allegato con la colonna password a punti e virgola: il riquadro si riapre con l\'avviso e il file segnato', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Allego l\'esportazione: il login fallisce sempre');
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'utenti.csv', mimeType: 'text/csv', buffer: Buffer.from('utente;password\nmario.rossi;hunter22\n') }]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await page.locator('.sn-fb-send').click();
  const avviso = page.locator('.sn-fb-l0');
  await expect(avviso).toBeVisible({ timeout: 12_000 });
  await expect(avviso).toContainText('In un file allegato c’è una password');
  await expect(page.locator('.sn-fb-file-chip--l0')).toContainText('utenti.csv');
  expect(await invii(app)).toEqual([]);
});

// #1403.2 — il controllo senza modello legge gli allegati fuori dal processo che tiene finestre e schede.
test('un log da 4 MB allegato: mentre si rilegge Filo risponde, e la password in fondo al log dà l\'avviso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  const righe = [];
  let n = 0;
  for (let i = 0; n < 4 * 1024 * 1024 - 2_000; i++) {
    const r = `2026-11-20T10:00:00.123Z INFO [net] GET https://example.com/api/v1/items?page=${i} status=200 durata=${i % 997}ms\n`;
    righe.push(r);
    n += r.length;
  }
  righe.push('utente = mario.rossi\npassword = hunter22\n');
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Allego il log: il login fallisce sempre.');
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'filo.log', mimeType: 'text/plain', buffer: Buffer.from(righe.join('')) }]);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  // Il passo più lungo fra due giri del processo principale, dall'invio all'avviso.
  await app.evaluate(() => {
    const l = { max: 0, ultimo: performance.now() };
    l.t = setInterval(() => { const ora = performance.now(); l.max = Math.max(l.max, ora - l.ultimo); l.ultimo = ora; }, 10);
    globalThis.__fermo = l;
  });
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0')).toContainText('In un file allegato c’è una password', { timeout: 30_000 });
  const fermo = await app.evaluate(() => { clearInterval(globalThis.__fermo.t); return globalThis.__fermo.max; });
  test.info().annotations.push({ type: 'fermo', description: `${Math.round(fermo)} ms` });
  expect(fermo, 'il processo di finestre e schede non resta fermo mentre si rilegge il log').toBeLessThan(250);
});

test('testo che scorre: lo sfondo delle evidenze va a capo come la casella, barra di scorrimento compresa', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: PASSWORD }] }) });
  const righe = Array.from({ length: 30 }, (_, i) => `Passo ${i + 1} del racconto.`);
  const dopo = Array.from({ length: 12 }, (_, i) => `Nota ${i + 1} in fondo.`);
  const testo = `Il login non va.\n${righe.join('\n')}\nQuinta riga.\nLa password è ${PASSWORD} e non entra.\n${dopo.join('\n')}`;
  await scriviEInvia(page, testo);
  await expect(page.locator('.sn-fb-l0')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('.sn-fb-evidenze mark')).toHaveText([PASSWORD]);

  // Righe sempre più lunghe in mezzo: a ogni lunghezza la casella e lo sfondo vanno a capo negli stessi punti.
  const esito = await page.evaluate(() => {
    const ta = document.querySelector('.sn-fb-text');
    const ev = document.querySelector('.sn-fb-evidenze');
    const base = ta.value;
    const at = base.indexOf('Quinta riga.');
    const diverse = [];
    for (let k = 1; k < 160; k++) {
      ta.value = `${base.slice(0, at)}Il codice di errore era ${'x'.repeat(k)}\n${base.slice(at)}`;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      if (ta.scrollHeight !== ev.scrollHeight) diverse.push(k);
    }
    // La riga della password a metà della casella, come dopo «Correggi».
    ta.scrollTop = Math.max(0, ev.querySelector('mark').offsetTop - ta.clientHeight / 2);
    ta.dispatchEvent(new Event('scroll'));
    const m = ev.querySelector('mark').getBoundingClientRect();
    const r = ta.getBoundingClientRect();
    return { diverse, barra: ta.offsetWidth - ta.clientWidth - 2, dentro: m.top >= r.top && m.bottom <= r.bottom, scorrono: ev.scrollTop === ta.scrollTop };
  });
  test.info().annotations.push({ type: 'barra', description: `${esito.barra} px` });
  expect(esito.diverse, `righe che vanno a capo in punti diversi (barra di ${esito.barra} px)`).toEqual([]);
  expect(esito.scorrono).toBe(true);
  expect(esito.dentro, 'l\'evidenza si vede nella casella, sotto la password').toBe(true);
  await page.locator('.sn-fb-modal').screenshot({ path: `${SHOTS}/1403.1-evidenza-scorre.png` });
});

// La scheda cambiata mentre la rilettura trova qualcosa: niente riquadro da riaprire, la segnalazione resta fra le
// non partite e la finestra lo dice.
test('pagina cambiata durante la rilettura che trova qualcosa: non parte, resta fra le non partite e la finestra lo dice', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { ritardo: 2_000, testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: PASSWORD }] }) });
  await scriviEInvia(page, TESTO);
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 1_000 });
  await page.evaluate(() => { location.href = 'filo://newtab/?altra=1'; });
  const mie = () => app.evaluate(async () => (await globalThis.SN_SEGNALAZIONI_MIE.elenco()).map((v) => ({ testo: v.testo, stato: v.stato })));
  await expect.poll(mie, { timeout: 12_000 }).toEqual([{ testo: TESTO, stato: 'non_partita' }]);
  await expect(shell.locator('.shell-notif-msg', { hasText: 'Il tuo feedback non è partito' })).toHaveCount(1);
  expect(await invii(app)).toEqual([]);
  expect(await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX.size())).toBe(0);
});

test('con un altro riquadro di feedback aperto, quello rimandato indietro aspetta che si chiuda e poi si riapre', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { ritardo: 1_500, testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: PASSWORD }] }) });
  await scriviEInvia(page, TESTO);
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 1_000 });
  // Un secondo feedback, aperto prima che la rilettura torni.
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('Un altro problema');
  await expect.poll(() => app.evaluate(() => globalThis.__l0.chiamate.includes('testo')), { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(2_500);
  await expect(page.locator('.sn-fb-modal')).toHaveCount(1);
  await expect(page.locator('.sn-fb-text')).toHaveValue('Un altro problema');
  await expect(page.locator('.sn-fb-l0')).toBeHidden();
  await page.locator('.sn-fb-cancel').click();
  await expect(page.locator('.sn-fb-l0')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.sn-fb-text')).toHaveValue(TESTO);
  await expect(page.locator('.sn-fb-evidenze mark')).toHaveText([PASSWORD]);
  expect(await invii(app)).toEqual([]);
});

// #1403.1 — la segnalazione scritta da Filo in chat e confermata passa dalla stessa rilettura. La password l'ha scritta
// l'utente: una che non ha scritto lui non esce mai (#810), e la sua la manda solo con la parola «conferma» (#2644).
const segnalazioneDaChat = async (app, testo) => {
  const r = await app.evaluate((_e, { a, richiesta }) => globalThis.SN_EXECUTE_FILO_ACTION(a, { richiesta }),
    { a: { type: 'INVIA_FEEDBACK', testo, titolo: 'Accesso alla banca' }, richiesta: testo });
  expect(r.needsConfirm, 'una password scritta dall\'utente esce con la parola «conferma»').toBe(3);
  return { type: 'INVIA_FEEDBACK', testo, titolo: 'Accesso alla banca', _confirm: { level: r.needsConfirm, text: r.describe, parti: r.parti } };
};
const confermaConLaParola = async (page) => {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  expect(await confirmText(page)).toContain('porterebbe fuori una password');
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
};

// #2645 — la parola «conferma» l'utente l'ha scritta per quella password: la rilettura non la ripropone, e il
// feedback parte senza un secondo riquadro per lo stesso motivo.
test('dalla chat della home: confermata la password con la parola, il feedback parte senza un secondo riquadro', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await imposta(app, { testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: PASSWORD }] }) });
  const action = await segnalazioneDaChat(app, TESTO);
  await page.evaluate((t) => window.__filoDashActions.scriveUtente(t), TESTO);
  await proponiInChat(page, action, 'prova-chat-1');
  await confermaConLaParola(page);
  await expect.poll(() => invii(app), { timeout: 12_000 }).toEqual([TESTO]);
  expect(await app.evaluate(() => globalThis.__invii[0].clientId)).toBe('filo:chat');
  expect(await chiamateTesto(app), 'la rilettura c\'è stata').toBeGreaterThan(0);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
});

// Il riquadro che vuole la parola non si apre da solo: si apre col clic sul bottone della proposta.
async function proponiInChat(page, action, id) {
  await page.evaluate(({ a, id }) => {
    const host = document.createElement('div');
    host.id = id;
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [a], { autoConfirm: true });
  }, { a: action, id });
  await page.locator(`#${id} .dash-action-btn`).click();
}

test('dalla chat della home: dopo la parola la rilettura ferma ancora un recapito, «Non mandarla» la tiene, «Manda così» la manda', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  const TELEFONO = '333 1234567';
  const testo = `${TESTO} Richiamatemi al ${TELEFONO}.`;
  await imposta(app, { testo: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: PASSWORD }, { tipo: 'recapito', pezzo: TELEFONO }] }) });
  const action = await segnalazioneDaChat(app, testo);
  await page.evaluate((t) => window.__filoDashActions.scriveUtente(t), testo);

  await proponiInChat(page, action, 'prova-chat-1');
  await confermaConLaParola(page);
  await expect.poll(() => confirmText(page), { timeout: 12_000 }).toContain('Prima che parta, ricontrolla.');
  expect(await confirmText(page)).toContain('recapito');
  expect(await confirmText(page), 'la password l\'ha già confermata con la parola').not.toContain('password');
  await page.screenshot({ path: `${SHOTS}/1403.1-chat-rilettura.png` });
  await clickConfirm(page, 'cancel');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  expect(await invii(app), '«Non mandarla»: non parte').toEqual([]);

  await proponiInChat(page, action, 'prova-chat-2');
  await confermaConLaParola(page);
  await expect.poll(() => confirmText(page), { timeout: 12_000 }).toContain('Prima che parta, ricontrolla.');
  const chiamate = await chiamateTesto(app);
  await clickConfirm(page, 'ok');
  await expect.poll(() => invii(app), { timeout: 12_000 }).toEqual([testo]);
  expect(await chiamateTesto(app), '«Manda così» non rilegge').toBe(chiamate);
});

test('dall\'Aiuto: la segnalazione confermata con la parola per la password parte, senza un secondo riquadro', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const azione = { type: 'INVIA_FEEDBACK', testo: TESTO, titolo: 'Accesso alla banca' };
  // Una password che l'utente non ha scritto non esce: niente riquadro, la riga dice che si è fermata.
  expect(await page.evaluate((a) => window.__filoSidebarTest.runFiloAction(a), azione)).toBe(false);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  expect(await invii(app)).toEqual([]);

  await page.evaluate((t) => window.__filoSidebarTest.scriveUtente(t), TESTO);
  await page.evaluate((a) => { window.__filoSidebarTest.runFiloAction(a); }, azione);
  await confermaConLaParola(page);
  // Il modello finto non trova niente e la password, che il controllo senza modello riconosce, è quella confermata.
  await expect.poll(() => invii(app), { timeout: 12_000 }).toEqual([TESTO]);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText('fatto');
});

// #1403.2 — un file della conversazione allegato alla segnalazione scritta da Filo arriva alla rilettura dopo l'OK.
test('dalla chat con un log della conversazione allegato: dopo l\'OK l\'avviso sul file, «Manda così» lo manda col file', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const log = join(cartellaTemporanea('filo-l0-chat-'), 'filo.log');
  writeFileSync(log, 'avvio...\nutente = mario.rossi\npassword = hunter22\nerrore 401\n');
  const page = await home(app);
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ titolo: 'Login', testo: 'Il login fallisce sempre.', allegati: [log] }) }] }, { text: 'Inviata.' }]);
  await finti(app);
  await chiedi(page, `manda il log con la segnalazione\nFile: ${log}`);

  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await aspettaConfermaPronta(page);
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect.poll(() => confirmText(page), { timeout: 12_000 }).toContain('Prima che parta, ricontrolla.');
  expect(await confirmText(page)).toContain('In un file allegato c’è una password');
  expect(await invii(app)).toEqual([]);
  expect(await app.evaluate(() => JSON.stringify(globalThis.__l0)).then((s) => s.includes('hunter22')), 'il log non va a nessun modello').toBe(false);
  await clickConfirm(page, 'ok');
  await expect.poll(() => invii(app), { timeout: 12_000 }).toEqual(['Il login fallisce sempre.']);
  expect(await app.evaluate(() => globalThis.__invii[0].files.map((f) => f.name))).toEqual(['filo.log']);
  await ripristina(app);
});

// #1403.2 — «Manda così» ripete la conferma della proposta: i contatori la contano una volta.
test('una segnalazione proposta da Filo e fermata dalla rilettura: confermata e mandata così, si conta una volta', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await finti(app);
  const TELEFONO = '333 1234567';
  const testo = `Lo zoom non va. Richiamatemi al ${TELEFONO}.`;
  await imposta(app, { testo: JSON.stringify({ trovati: [{ tipo: 'recapito', pezzo: TELEFONO }] }) });
  await app.evaluate(() => {
    globalThis.__proposte = [];
    const m = globalThis.SN_CONTATORI_SERVIZIO_MAIN || (globalThis.SN_CONTATORI_SERVIZIO_MAIN = {});
    const prima = m.proposta;
    m.proposta = (esito) => { globalThis.__proposte.push(esito); return typeof prima === 'function' ? prima(esito) : true; };
  });
  const a = { type: 'INVIA_FEEDBACK', testo, titolo: 'Zoom', _proposta: true };
  const r = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a, { richiesta: a.testo }), a);
  expect(r.needsConfirm).toBeGreaterThan(0);
  const proposta = { ...a, _confirm: { level: r.needsConfirm, text: r.describe, parti: r.parti } };
  // Sotto la parola il riquadro si apre da solo; con la parola, dal clic sul bottone.
  if (r.needsConfirm >= 3) await proponiInChat(page, proposta, 'prova-proposta');
  else await page.evaluate((a) => window.__filoDashActions.renderActions(document.body.appendChild(document.createElement('div')), [a], { autoConfirm: true }), proposta);
  await expect(page.locator(CONFIRM_HOST)).toBeVisible();
  if (r.needsConfirm >= 3) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, r.needsConfirm >= 3 ? 'danger' : 'ok');
  await expect.poll(() => confirmText(page), { timeout: 12_000 }).toContain('Prima che parta, ricontrolla.');
  await clickConfirm(page, 'ok');
  await expect.poll(() => invii(app), { timeout: 12_000 }).toEqual([testo]);
  expect(await app.evaluate(() => globalThis.__proposte)).toEqual(['confermata']);
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

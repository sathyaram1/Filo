// #779 — «Filo può usare le altre applicazioni» in Preferenze: spenta di serie e niente sul disco; accesa scarica il
// componente con la barra vera e lo installa; un'impronta sbagliata non si installa e lo si legge in chiaro; spenta lo
// toglie. Dalla chat la stessa cosa, dopo «conferma». Il pacchetto è un driver finto servito in locale; foto in tests/.shots/.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmState, fillConfirmInput, scrollConfirmToEnd } from './helpers/confirm.mjs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as zlib from 'node:zlib';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

test.skip(process.platform === 'win32', 'il driver finto è uno script sh: su Windows lo coprono gli unit test');

const SHOTS = 'tests/.shots';
const FINTO = resolve('tests/fixtures/cua-driver-finto.mjs');
const LAVORO = cartellaTemporanea('filo-altreapp-e2e-');
const ELENCO = join(LAVORO, 'pacchetti.json');
process.env.FILO_ALTRE_APP_PACCHETTI = ELENCO;

function tarDi(voci) {
  const blocchi = [];
  for (const [nome, contenuto] of voci) {
    const dati = Buffer.from(contenuto);
    const h = Buffer.alloc(512);
    h.write(nome, 0); h.write('0000755', 100); h.write('0000000', 108); h.write('0000000', 116);
    h.write(dati.length.toString(8).padStart(11, '0'), 124); h.write('00000000000', 136); h.write('0', 156);
    h.write('ustar\u0000', 257, 'latin1'); h.write('00', 263); h.fill(32, 148, 156);
    let s = 0; for (const b of h) s += b;
    h.write(`${s.toString(8).padStart(6, '0')}\u0000 `, 148, 'latin1');
    blocchi.push(h, dati, Buffer.alloc((512 - (dati.length % 512)) % 512));
  }
  blocchi.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocchi), { level: 0 });
}

// Un po' di zavorra non comprimibile: il file deve pesare abbastanza da vedere la barra a metà.
const FILE = tarDi([
  ['cua-driver', `#!/bin/sh\nexec "${process.execPath}" "${FINTO}" "$@"\n`],
  ['zavorra.bin', createHash('sha512').update('x').digest('hex').repeat(6000)],
]);
const SHA = createHash('sha256').update(FILE).digest('hex');
let server;

function scriviElenco(sha256) {
  writeFileSync(ELENCO, JSON.stringify({
    VERSIONE: '0.0.1-prova',
    BASE: `http://127.0.0.1:${server.address().port}/`,
    PACCHETTI: { [`${process.platform}-${process.arch}`]: { file: 'finto.tar.gz', sha256, byte: FILE.length, formato: 'tar.gz', eseguibile: 'cua-driver' } },
  }));
}

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Length': FILE.length });
    const passo = Math.ceil(FILE.length / 40);
    for (let i = 0; i < FILE.length; i += passo) {
      if (res.destroyed) return;
      res.write(FILE.subarray(i, i + passo));
      await new Promise((r) => setTimeout(r, 60));
    }
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
test.afterAll(async () => {
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  togliCartella(LAVORO);
});

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const cartellaComponente = async (app) => join(await app.evaluate(() => process.env.FILO_USER_DATA), 'componenti', 'cua-driver');
async function tema(page, t) {
  await page.evaluate((x) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: x } }), t);
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', t);
}
async function foto(pref, nome) {
  mkdirSync(SHOTS, { recursive: true });
  await pref.locator('#sec-altre-app').scrollIntoViewIfNeeded();
  for (const t of ['light', 'dark']) {
    await tema(pref, t);
    await pref.locator('#sec-altre-app').screenshot({ path: `${SHOTS}/altre-app-${nome}-${t}.png` });
  }
  await tema(pref, 'light');
}

test('spenta di serie e niente sul disco; accesa scarica con la barra vera e installa; spenta lo toglie', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  scriviElenco(SHA);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  const casella = pref.locator('#altreAppEnabled');
  await expect(casella).not.toBeChecked({ timeout: 8_000 });
  await expect(pref.locator('#sec-altre-app')).toContainText('Filo può usare le altre applicazioni');
  await expect(pref.locator('#altreAppStato')).toBeHidden();
  const dir = await cartellaComponente(app);
  expect(existsSync(dir), 'un\'installazione con l\'impostazione spenta non contiene il componente').toBe(false);

  await casella.check();
  await expect.poll(async () => (await impostazioni(app)).altreApp?.enabled).toBe(true);
  const barra = pref.locator('#altreAppBarra');
  await expect(pref.locator('#altreAppFrase')).toHaveText('Scarico il componente…', { timeout: 5_000 });
  // La barra si riempie coi byte veri: si vede a metà, coi numeri di quanto è arrivato.
  await expect.poll(async () => Number(await barra.getAttribute('aria-valuenow')) || 0, { timeout: 10_000 }).toBeGreaterThan(5);
  const meta = Number(await barra.getAttribute('aria-valuenow'));
  expect(meta).toBeLessThan(100);
  await expect(pref.locator('#altreAppNumeri')).toContainText(/MB di .* MB · \d+%/);
  await expect(pref.locator('#altreAppAnnulla')).toBeVisible();
  await expect(pref.locator('#altreAppRiprova')).toBeHidden();
  await foto(pref, 'scarica');

  await expect(pref.locator('#altreAppFrase')).toHaveText('Il componente è installato e pronto.', { timeout: 20_000 });
  await expect(pref.locator('#altreAppNumeri')).toContainText('Cua Driver 0.0.1-prova');
  await expect(barra).toBeHidden();
  expect(existsSync(join(dir, '0.0.1-prova', 'cua-driver'))).toBe(true);
  await foto(pref, 'pronto');

  await casella.uncheck();
  await expect.poll(async () => (await impostazioni(app)).altreApp?.enabled).toBe(false);
  await expect(pref.locator('#altreAppStato')).toBeHidden();
  await expect.poll(() => existsSync(dir), { timeout: 10_000 }).toBe(false);
});

test('con un\'impronta sbagliata non si installa, e la pagina dice in chiaro perché', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  scriviElenco('0'.repeat(64));
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#altreAppEnabled').check();
  await expect(pref.locator('#altreAppFrase')).toContainText('la sua impronta non combacia, quindi non l\'ho installato', { timeout: 20_000 });
  await expect(pref.locator('#altreAppStato')).toHaveClass(/aa-errore/);
  await expect(pref.locator('#altreAppRiprova')).toHaveText('Riprova');
  await expect(pref.locator('#altreAppAnnulla')).toBeHidden();
  const dir = await cartellaComponente(app);
  expect(existsSync(join(dir, '0.0.1-prova'))).toBe(false);
  await foto(pref, 'impronta');

  // Riprovare col file giusto lo installa.
  scriviElenco(SHA);
  await pref.locator('#altreAppRiprova').click();
  await expect(pref.locator('#altreAppFrase')).toHaveText('Il componente è installato e pronto.', { timeout: 20_000 });
  expect(existsSync(join(dir, '0.0.1-prova', 'cua-driver'))).toBe(true);
});

test('«Annulla» a metà dello scaricamento spegne l\'impostazione e non lascia niente sul disco', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  scriviElenco(SHA);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#altreAppEnabled').check();
  await expect.poll(async () => Number(await pref.locator('#altreAppBarra').getAttribute('aria-valuenow')) || 0, { timeout: 10_000 }).toBeGreaterThan(0);
  await pref.locator('#altreAppAnnulla').click();
  await expect(pref.locator('#altreAppEnabled')).not.toBeChecked();
  await expect.poll(async () => (await impostazioni(app)).altreApp?.enabled).toBe(false);
  await expect(pref.locator('#altreAppStato')).toBeHidden();
  const dir = await cartellaComponente(app);
  await expect.poll(() => existsSync(dir), { timeout: 10_000 }).toBe(false);
  // Riaccesa subito dopo, riparte da capo e arriva in fondo.
  await pref.locator('#altreAppEnabled').check();
  await expect(pref.locator('#altreAppFrase')).toHaveText('Il componente è installato e pronto.', { timeout: 20_000 });
});

test('i permessi che mancano (su Mac) si leggono uno per uno, ognuno col pulsante del suo pannello', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#altreAppEnabled').evaluate((el) => { el.checked = true; });
  // Lo stato come lo manda il main su un Mac senza permessi: qui si guarda solo come la pagina lo disegna.
  await pref.evaluate(() => window.SN_PREF_ALTRE_APP.disegna({
    attiva: true, fase: 'pronto', versione: '0.35.4', byte: 96341278,
    permessi: [
      { id: 'accessibilita', nome: 'Accessibilità', frase: 'Su Mac serve il permesso «Accessibilità» per Filo, per leggere e toccare le finestre.', apribile: true },
      { id: 'schermo', nome: 'Registrazione schermo', frase: 'Su Mac serve il permesso «Registrazione schermo» per Filo, per vedere le finestre.', apribile: true },
    ],
  }));
  await expect(pref.locator('#altreAppFrase')).toContainText('non gli dà ancora tutto quello che serve');
  await expect(pref.locator('.aa-permesso')).toHaveCount(2);
  await expect(pref.locator('.aa-permesso button')).toHaveText(['Apri le impostazioni del sistema', 'Apri le impostazioni del sistema']);
  await expect(pref.locator('#altreAppNumeri')).toHaveText('Cua Driver 0.35.4 · 91,9 MB');
  await foto(pref, 'permessi');
  // Fuori dal Mac il main risponde che non c'è un pannello da aprire: il pulsante torna usabile.
  await pref.locator('.aa-permesso button').first().click();
  await expect(pref.locator('.aa-permesso button').first()).toBeEnabled();
});

test('dalla chat: la conferma spiega cosa si installa, e dopo «conferma» le Preferenze aperte lo mostrano installato', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  scriviElenco(SHA);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#altreAppEnabled')).not.toBeChecked({ timeout: 8_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const giri = [
      { toolCalls: [{ id: 'a1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'altre_applicazioni', valore: true }) }] },
      { text: 'Ti chiedo conferma.' },
    ];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = giri[Math.min(n++, giri.length - 1)];
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  });
  const chat = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await chat.bringToFront();
  await chat.locator('#input').fill('puoi usare le altre applicazioni');
  await chat.locator('#sendBtn').click();
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 10_000 }).toContain('Cua Driver');
  expect((await confirmState(chat)).text).toMatch(/ne controlla l'impronta/);
  expect((await impostazioni(app)).altreApp.enabled, 'accesa prima dell\'OK').toBe(false);
  await fillConfirmInput(chat, 'conferma');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger');
  await expect.poll(async () => (await impostazioni(app)).altreApp?.enabled, { timeout: 5_000 }).toBe(true);
  await expect(pref.locator('#altreAppEnabled')).toBeChecked({ timeout: 5_000 });
  await expect(pref.locator('#altreAppFrase')).toHaveText('Il componente è installato e pronto.', { timeout: 20_000 });
});

// #666 — chiudere una scheda non dà alla pagina nessun evento: con caselle ancora da spedire la pagina viene avvisata e
// la sua WebContents si chiude quando ha spedito, o al tetto; senza, si chiude subito come prima.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../src/main/tabs/chiusuraConCaselle.js');

function finta() {
  return {
    chiusa: 0, inviati: [], muta: false, morta: false,
    isDestroyed() { return this.morta; },
    close() { this.chiusa += 1; this.morta = true; },
    send(canale, m) { this.inviati.push([canale, m]); },
    setAudioMuted(v) { this.muta = v; },
  };
}

test('senza caselle in sospeso la pagina si chiude subito, senza messaggi', () => {
  const wc = finta();
  C.chiudi(wc);
  assert.equal(wc.chiusa, 1);
  assert.deepEqual(wc.inviati, []);
});

test('con caselle in sospeso la pagina sa che esce, e si chiude quando dice di aver spedito', () => {
  const wc = finta();
  C.segna(wc, true);
  C.chiudi(wc);
  assert.equal(wc.chiusa, 0);
  assert.deepEqual(wc.inviati, [['filo:broadcast', { type: 'tab_in_vista', inVista: false }]]);
  assert.equal(wc.muta, true);
  // Una seconda chiusura mentre aspetta non manda un secondo avviso.
  C.chiudi(wc);
  assert.equal(wc.inviati.length, 1);
  C.segna(wc, false);
  assert.equal(wc.chiusa, 1);
  C.segna(wc, false);
  assert.equal(wc.chiusa, 1);
});

test('una pagina che non risponde si chiude al tetto', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wc = finta();
  C.segna(wc, true);
  C.chiudi(wc);
  t.mock.timers.tick(C.TETTO_MS - 1);
  assert.equal(wc.chiusa, 0);
  t.mock.timers.tick(1);
  assert.equal(wc.chiusa, 1);
});

test('una WebContents già distrutta o senza isDestroyed non fa danni', () => {
  const morta = finta();
  morta.morta = true;
  C.chiudi(morta);
  assert.equal(morta.chiusa, 0);
  let chiusa = 0;
  C.chiudi({ close() { chiusa += 1; } });
  assert.equal(chiusa, 1);
  C.chiudi(null);
});

// Chiudere la finestra e uscire da Filo distruggono le schede senza chiamare `chiudi`: si aspettano le pagine in sospeso.
test('alla chiusura della finestra si aspettano solo le pagine in sospeso, e il «niente più» sblocca', async () => {
  const ferma = finta();
  const scritta = finta();
  const morta = finta();
  morta.morta = true;
  C.segna(scritta, true);
  C.segna(morta, true);
  assert.equal(C.congedaSchede({ tabs: [{ view: { webContents: ferma } }] }), null);
  assert.equal(C.congedaSchede(null), null);
  const attesa = C.congedaSchede({ tabs: [{ view: { webContents: ferma } }, { view: { webContents: scritta } }, { view: { webContents: morta } }, {}] });
  assert.ok(attesa);
  assert.deepEqual(ferma.inviati, []);
  assert.deepEqual(scritta.inviati, [['filo:broadcast', { type: 'tab_in_vista', inVista: false }]]);
  // La distruzione la fa la finestra: qui nessuno chiude la pagina.
  C.segna(scritta, false);
  await attesa;
  assert.equal(scritta.chiusa, 0);
});

test('una pagina che non risponde non trattiene la finestra oltre il tetto', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wc = finta();
  C.segna(wc, true);
  let finito = false;
  const attesa = C.congedaSchede({ tabs: [{ view: { webContents: wc } }] }).then(() => { finito = true; });
  const microtask = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  t.mock.timers.tick(C.TETTO_MS - 1);
  await microtask();
  assert.equal(finito, false);
  t.mock.timers.tick(1);
  await attesa;
  assert.equal(finito, true);
});

test('la scheda che si chiude mentre la finestra aspetta riceve un avviso solo', () => {
  const wc = finta();
  C.segna(wc, true);
  C.congedaSchede({ tabs: [{ view: { webContents: wc } }] });
  C.chiudi(wc);
  assert.equal(wc.inviati.length, 1);
  C.segna(wc, false);
  assert.equal(wc.chiusa, 1);
});

// Le tre uscite di una pagina interna passano tutte di qui: chiudere la scheda, chiudere la finestra, spegnere Filo.
test('scheda, finestra e uscita da Filo chiedono tutte a chiusuraConCaselle', async () => {
  const { readFileSync } = await import('node:fs');
  const leggi = (f) => readFileSync(new URL(`../../src/main/${f}`, import.meta.url), 'utf8');
  const tabs = leggi('tabs.js');
  assert.doesNotMatch(tabs, /\.webContents\.close\(\)/, 'una scheda chiusa senza aspettare le sue caselle');
  assert.match(tabs, /ChiusuraConCaselle\.chiudi\(/);
  assert.match(leggi('window.js'), /on\('close'[\s\S]{0,400}congedaSchede\(/);
  assert.match(leggi('main.js'), /on\('before-quit'[\s\S]{0,600}congedaSchede\(/);
});

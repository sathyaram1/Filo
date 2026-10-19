// Le caselle senza «Salva»: la conferma parla dell'ultima modifica, l'uscita vera (anche l'avviso del main prima
// di chiudere scheda, finestra o Filo) fa partire quello che è in sospeso, e un campo che si conferma lasciandolo parte solo lì.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = join(__dirname, '..', '..');

// Una finestra finta che basta al modulo: ascoltatori per tipo, da far scattare a mano, e il canale verso il main.
function finestra() {
  const ascolti = {};
  const on = (tipo, fn) => { (ascolti[tipo] = ascolti[tipo] || []).push(fn); };
  const scatta = (tipo, e = {}) => { for (const fn of ascolti[tipo] || []) fn(e); };
  const document = { visibilityState: 'visible', addEventListener: on };
  const alMain = [];
  const dalMain = [];
  const chrome = {
    runtime: {
      sendMessage: (m) => { alMain.push(m); return Promise.resolve({ ok: true }); },
      onMessage: { addListener: (fn) => dalMain.push(fn) },
    },
  };
  const SN_MSG = { MSG: { CASELLE_IN_SOSPESO: 'caselle_in_sospeso', TAB_IN_VISTA: 'tab_in_vista' } };
  const w = { document, chrome, SN_MSG, addEventListener: on, setTimeout, clearTimeout };
  const codice = readFileSync(join(RADICE, 'src', 'shared', 'caselleAlSicuro.js'), 'utf8');
  new Function('window', 'globalThis', codice)(w, w);
  const sospeso = () => alMain.filter((m) => m.type === 'caselle_in_sospeso').map((m) => m.inSospeso);
  const avvisoDelMain = (m) => { for (const fn of dalMain) fn(m); };
  return { C: w.SN_CASELLE, scatta, sospeso, avvisoDelMain, alMain, w };
}

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

test('una conferma vale solo se dopo la spedizione non è cambiato niente', () => {
  const { C } = finestra();
  const c = C.crea();
  c.registra('pref', () => {});
  const primo = c.spedita('pref');
  assert.equal(c.aggiornata('pref', primo), true);
  // Una modifica arriva mentre il primo salvataggio viaggia: il suo «Salvato» non deve accendersi.
  c.cambiato('pref', { inputType: 'insertText' });
  assert.equal(c.aggiornata('pref', primo), false);
  const secondo = c.spedita('pref');
  assert.equal(c.aggiornata('pref', primo), false);
  assert.equal(c.aggiornata('pref', secondo), true);
});

test('due spedizioni di fila: conferma solo l\'ultima', () => {
  const { C } = finestra();
  const c = C.crea();
  const a = c.spedita('pagina');
  const b = c.spedita('pagina');
  assert.equal(c.aggiornata('pagina', a), false);
  assert.equal(c.aggiornata('pagina', b), true);
});

test('il pagehide (ricarica) fa partire quello in sospeso', () => {
  const { C, scatta } = finestra();
  const partiti = [];
  let uscite = 0;
  const c = C.crea({ uscita: () => { uscite += 1; } });
  c.registra('frase', (avvisi) => partiti.push(avvisi));
  c.cambiato('frase', { inputType: 'insertText' }, { pausa: 60000 });
  assert.equal(c.inAttesa('frase'), true);
  scatta('pagehide');
  assert.deepEqual(partiti, [true]);
  assert.equal(c.inAttesa('frase'), false);
  assert.equal(uscite, 1);
});

test('la pausa fa partire una volta sola', async () => {
  const { C } = finestra();
  let n = 0;
  const c = C.crea();
  c.registra('x', () => { n += 1; });
  c.cambiato('x', { inputType: 'insertText' }, { pausa: 20 });
  c.cambiato('x', { inputType: 'insertText' }, { pausa: 20 });
  await attesa(70);
  assert.equal(n, 1);
});

test('un campo al volo non parte al Ctrl né alla perdita del fuoco, ma all\'uscita vera sì', () => {
  const { C, scatta } = finestra();
  C.crea();
  const fatti = [];
  const campo = C.alVolo();
  campo.scrivendo(() => fatti.push('confermato'));
  scatta('keydown', { key: 'Control' });
  scatta('blur');
  assert.deepEqual(fatti, []);
  scatta('pagehide');
  assert.deepEqual(fatti, ['confermato']);
  // Confermato a mano (Invio, o il cursore che esce), l'uscita non lo rifà.
  campo.scrivendo(() => fatti.push('secondo'));
  campo.confermato();
  scatta('pagehide');
  assert.deepEqual(fatti, ['confermato']);
});

// Il main aspetta a chiudere solo una pagina che ha detto di avere qualcosa da spedire (#666): lo stato è della pagina.
const fineGiro = async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); };

test('due istanze nella stessa pagina non si smentiscono: il main sente «niente più» solo quando non resta niente', async () => {
  const { C, sospeso } = finestra();
  const opzioni = C.crea();
  const altro = C.crea();
  opzioni.registra('pagina', () => {});
  altro.registra('blocklist', () => {});
  opzioni.cambiato('pagina', { inputType: 'insertText' }, { pausa: 60000 });
  altro.cambiato('blocklist', { inputType: 'insertText' }, { pausa: 60000 });
  altro.spedita('blocklist');
  await fineGiro();
  assert.deepEqual(sospeso(), [true]);
  opzioni.spedita('pagina');
  await fineGiro();
  assert.deepEqual(sospeso(), [true, false]);
});

test('un campo al volo dice al main di aspettare, e l\'avviso di chiusura lo conferma', async () => {
  const { C, sospeso, avvisoDelMain } = finestra();
  const fatti = [];
  const campo = C.alVolo();
  campo.scrivendo(() => { fatti.push('confermato'); campo.confermato(); });
  assert.deepEqual(sospeso(), [true]);
  avvisoDelMain({ type: 'tab_in_vista', inVista: false });
  assert.deepEqual(fatti, ['confermato']);
  await fineGiro();
  assert.deepEqual(sospeso(), [true, false]);
});

test('l\'avviso di chiusura del main fa partire le caselle in sospeso, e il loro messaggio arriva prima del «niente più»', async () => {
  const { C, avvisoDelMain, alMain, w } = finestra();
  const c = C.crea();
  c.registra('pref', () => { c.spedita('pref'); w.chrome.runtime.sendMessage({ type: 'update_settings' }); });
  c.cambiato('pref', { inputType: 'insertText' }, { pausa: 60000 });
  avvisoDelMain({ type: 'tab_in_vista', inVista: false });
  await fineGiro();
  assert.deepEqual(alMain.map((m) => (m.type === 'caselle_in_sospeso' ? m.inSospeso : m.type)), [true, 'update_settings', false]);
});

// Una pagina che salva da sé non si riscrive le uscite in casa: le chiede a SN_CASELLE, o al giro dopo una diverge.
const PAGINE = [
  ['options', 'options'], ['options', 'altro'], ['preferences', 'preferences'], ['security', 'security'],
  ['manage', 'manage'], ['feedback', 'feedback'],
];
const AL_VOLO = [['editor', 'editor'], ['spellcheck', 'spellcheck']];

test('le pagine che salvano da sole usano la regola condivisa', () => {
  for (const [cartella, nome] of PAGINE) {
    const testo = readFileSync(join(RADICE, 'src', 'pages', cartella, `${nome}.js`), 'utf8');
    assert.match(testo, /SN_CASELLE\.crea\(/, `${cartella}/${nome}.js non usa SN_CASELLE`);
    assert.doesNotMatch(testo, /addEventListener\(\s*(uscita|'pagehide'|'beforeunload')/, `${cartella}/${nome}.js si riscrive l'uscita in casa`);
  }
  for (const [cartella, nome] of AL_VOLO) {
    const testo = readFileSync(join(RADICE, 'src', 'pages', cartella, `${nome}.js`), 'utf8');
    assert.match(testo, /SN_CASELLE\.alVolo\(\)/, `${cartella}/${nome}.js non registra il campo sotto il cursore`);
    assert.match(testo, /campoAlVolo\.scrivendo\(/, `${cartella}/${nome}.js non dice cosa confermare`);
  }
});

test('ogni pagina che usa la regola carica il modulo', () => {
  for (const [cartella, nome] of [...PAGINE, ...AL_VOLO]) {
    const html = readFileSync(join(RADICE, 'src', 'pages', cartella, `${nome}.html`), 'utf8');
    assert.match(html, /shared\/caselleAlSicuro\.js/, `${cartella}/${nome}.html non carica caselleAlSicuro`);
  }
});

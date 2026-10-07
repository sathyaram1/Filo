// Le caselle senza «Salva»: la conferma parla dell'ultima modifica, l'uscita vera (anche l'avviso del main prima
// di chiudere una scheda) fa partire quello che è in sospeso, e un campo che si conferma lasciandolo parte solo lì.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RADICE = join(__dirname, '..', '..');

// Una finestra finta che basta al modulo: ascoltatori per tipo, da far scattare a mano.
function finestra() {
  const ascolti = {};
  const on = (tipo, fn) => { (ascolti[tipo] = ascolti[tipo] || []).push(fn); };
  const scatta = (tipo, e = {}) => { for (const fn of ascolti[tipo] || []) fn(e); };
  const document = { visibilityState: 'visible', addEventListener: on };
  const w = { document, addEventListener: on, setTimeout, clearTimeout };
  const codice = readFileSync(join(RADICE, 'src', 'shared', 'caselleAlSicuro.js'), 'utf8');
  new Function('window', 'globalThis', codice)(w, w);
  return { C: w.SN_CASELLE, scatta };
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

test('il pagehide mandato dal main prima di chiudere fa partire quello in sospeso', () => {
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

test('l\'avviso del main arriva alla pagina come beforeunload e come pagehide', () => {
  const preload = readFileSync(join(RADICE, 'src', 'preload', 'internal-preload.js'), 'utf8');
  const blocco = preload.slice(preload.indexOf('filo:pagina-sparisce'));
  assert.match(blocco, /dispatchEvent\(new Event\('beforeunload'/);
  assert.match(blocco, /'pagehide'/);
});

// Una pagina che salva da sé non si riscrive le uscite in casa: le chiede a SN_CASELLE, o al giro dopo una diverge.
const PAGINE = [
  ['options', 'options'], ['options', 'altro'], ['preferences', 'preferences'], ['security', 'security'],
  ['manage', 'manage'], ['feedback', 'feedback'],
];
const AL_VOLO = [['editor', 'editor'], ['spellcheck', 'spellcheck'], ['archive', 'archive']];

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

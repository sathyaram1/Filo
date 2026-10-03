// Sentinella di src/shared/avvisiTempo.js: quanto resta un avviso a scomparsa e quando aspetta (#630).
// La durata delle Preferenze vale per l'avviso standard e porta in scala tutti gli altri; col puntatore
// sopra un avviso i tempi di tutta la pila si fermano, e all'uscita a chi era agli sgoccioli resta tempo.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'avvisiTempo.js'));
const A = globalThis.SN_AVVISI;

test('la durata standard è quella predefinita delle Preferenze', () => {
  assert.equal(A.STANDARD_SEC, globalThis.SN_CONST.DEFAULT_SETTINGS.notifications.durationSec);
});

test('con la durata predefinita ogni avviso dura quanto chiede chi lo mostra', () => {
  assert.equal(A.durata(2200, 5), 2200);
  assert.equal(A.durata(8000, 5), 8000);
});

test('la durata delle Preferenze allunga e accorcia tutti in proporzione', () => {
  assert.equal(A.durata(2200, 10), 4400);
  assert.equal(A.durata(5000, 10), 10000);
  assert.equal(A.durata(7000, 1), 1400);
});

test('0 vuol dire «resta»: lo chiede chi mostra (un lavoro in corso) o l’utente', () => {
  assert.equal(A.durata(0, 5), 0);
  assert.equal(A.durata(0, 10), 0);
  assert.equal(A.durata(2200, 0), 0);
});

test('valori rotti non fanno sparire né inchiodare un avviso', () => {
  assert.equal(A.durata(undefined, 5), 5000);
  assert.equal(A.durata(NaN, 5), 5000);
  assert.equal(A.durata(-3, 5), 5000);
  assert.equal(A.durata(2200, 'abc'), 2200);
  assert.equal(A.durata(2200, -1), 2200);
  assert.ok(A.durata(1, 1) >= 1);
});

test('imposta() fa valere la preferenza per chi non la passa', () => {
  try {
    A.imposta({ durationSec: 10 });
    assert.equal(A.durata(2200), 4400);
    A.imposta({ durationSec: 0 });
    assert.equal(A.durata(2200), 0);
    A.imposta({ durationSec: 'rotto' });
    assert.equal(A.durata(2200), 2200);
    A.imposta(null);
    assert.equal(A.durata(2200), 2200, 'impostazioni mancanti: resta l’ultima preferenza valida');
  } finally {
    A.imposta({ durationSec: 5 });
  }
});

test('l’orologio scade da solo e annulla() lo spegne', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const o = A.orologio();
  let scaduti = 0;
  o.avvia(1000, () => { scaduti++; });
  const via = o.avvia(1000, () => { scaduti += 10; });
  via.annulla();
  t.mock.timers.tick(999);
  assert.equal(scaduti, 0);
  t.mock.timers.tick(1);
  assert.equal(scaduti, 1);
});

test('fermo, nessun tempo corre; ripartito, quello che restava riprende', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const o = A.orologio();
  let scaduto = false;
  o.avvia(10000, () => { scaduto = true; });
  t.mock.timers.tick(4000);
  o.ferma(true);
  t.mock.timers.tick(60000);
  assert.equal(scaduto, false, 'col puntatore sopra l’avviso non deve scadere');
  o.ferma(false);
  t.mock.timers.tick(5999);
  assert.equal(scaduto, false);
  t.mock.timers.tick(1);
  assert.equal(scaduto, true);
});

test('uscito il puntatore, a chi era agli sgoccioli restano almeno RIPRESA_MS', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const o = A.orologio();
  let scaduto = false;
  o.avvia(1000, () => { scaduto = true; });
  t.mock.timers.tick(900);
  o.ferma(true);
  o.ferma(false);
  t.mock.timers.tick(A.RIPRESA_MS - 1);
  assert.equal(scaduto, false);
  t.mock.timers.tick(1);
  assert.equal(scaduto, true);
});

test('un avviso nato mentre la pila è ferma aspetta anche lui', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const o = A.orologio();
  o.ferma(true);
  let scaduto = false;
  o.avvia(500, () => { scaduto = true; });
  t.mock.timers.tick(10000);
  assert.equal(scaduto, false);
  o.ferma(false);
  t.mock.timers.tick(A.RIPRESA_MS);
  assert.equal(scaduto, true);
});

// Un elemento finto con quello che segui() usa: ascoltatori ed eventi con isTrusted.
function elemento() {
  const asc = {};
  return {
    isConnected: true,
    addEventListener(tipo, fn) { (asc[tipo] ||= []).push(fn); },
    manda(tipo, isTrusted = true) { for (const fn of asc[tipo] || []) fn({ isTrusted }); },
  };
}

test('segui(): il puntatore su un avviso ferma la pila, l’uscita la riavvia', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const o = A.orologio();
  const a = o.segui(elemento());
  const b = o.segui(elemento());
  let scaduti = 0;
  o.avvia(1000, () => { scaduti++; });
  a.manda('mouseenter');
  assert.equal(o.fermo(), true);
  // Dal primo al secondo avviso: la pila resta ferma.
  b.manda('mouseenter');
  a.manda('mouseleave');
  t.mock.timers.tick(5000);
  assert.equal(scaduti, 0);
  b.manda('mouseleave');
  assert.equal(o.fermo(), false);
  t.mock.timers.tick(A.RIPRESA_MS);
  assert.equal(scaduti, 1);
});

test('segui(): un gesto fabbricato dalla pagina non tiene fermo niente', () => {
  const o = A.orologio();
  const a = o.segui(elemento());
  a.manda('mouseenter', false);
  assert.equal(o.fermo(), false);
});

test('un avviso che sparisce sotto il cursore non lascia la pila ferma', () => {
  const o = A.orologio();
  const a = o.segui(elemento());
  a.manda('mouseenter');
  o.lascia(a);
  assert.equal(o.fermo(), false);
  // Portato via col suo contenitore, senza che nessuno chiami lascia().
  const b = o.segui(elemento());
  b.manda('mouseenter');
  b.isConnected = false;
  o.ripulisci();
  assert.equal(o.fermo(), false);
});

test('ogni pila di avvisi a scomparsa prende i tempi da qui', () => {
  const leggi = (f) => readFileSync(join(ROOT, f), 'utf8');
  const usi = {
    'src/renderer/shell.js': /SN_AVVISI\.orologio\(\)/,
    'src/content/popup.js': /SN_AVVISI\.orologio\(\)/,
    'src/pages/editor/editor.js': /SN_AVVISI\.orologio\(\)/,
    'src/pages/decks/decks.js': /SN_AVVISI\.orologio\(\)/,
    'src/pages/manage/manage.js': /SN_AVVISI\.orologio\(\)/,
  };
  for (const [f, re] of Object.entries(usi)) assert.match(leggi(f), re, `${f} non usa l’orologio degli avvisi`);
  // Chi carica quelle pile carica anche il modulo, prima.
  for (const f of ['src/renderer/shell.html', 'src/pages/editor/editor.html', 'src/pages/decks/decks.html', 'src/pages/manage/manage.html']) {
    assert.match(leggi(f), /filo:\/\/shared\/avvisiTempo\.js/, `${f} non carica avvisiTempo.js`);
  }
  for (const f of ['src/preload/page-preload.js', 'src/preload/internal-preload.js']) {
    const src = leggi(f);
    const modulo = src.indexOf("'avvisiTempo.js'");
    assert.ok(modulo > 0 && modulo < src.indexOf("'popup.js'"), `${f}: avvisiTempo.js va caricato prima di popup.js`);
  }
  // Nessun avviso della pagina torna a un setTimeout fisso.
  assert.doesNotMatch(leggi('src/content/popup.js'), /setTimeout\(close,/);
});

// #737 — il «Salta» delle pubblicità dei video: chi può avere il clic vero, dove cade, quanto spesso, e chi lo spegne.
// Il clic vero è un gesto dell'utente per la pagina: fuori da YouTube un sito si farebbe un pulsante finto per averlo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'preferences.js'));
const A = require(join(ROOT, 'src', 'main', 'services', 'adSkip.js'));
const W = require(join(ROOT, 'src', 'main', 'services', 'impostazioniPerOrigine.js'));

test('acceso di serie, spento solo da un false esplicito', () => {
  assert.equal(globalThis.SN_CONST.DEFAULT_SETTINGS.security.adSkip.enabled, true);
  assert.equal(A.attivo({}), true);
  assert.equal(A.attivo({ security: { adSkip: { enabled: true } } }), true);
  assert.equal(A.attivo({ security: { adSkip: { enabled: false } } }), false);
});

test('il clic vero solo su YouTube, in http(s)', () => {
  for (const u of ['https://www.youtube.com/watch?v=x', 'https://youtube.com/', 'https://music.youtube.com/', 'http://m.youtube.com:8080/a']) {
    assert.equal(A.hostConClicVero(u), true, u);
  }
  for (const u of ['https://youtube.com.evil.example/', 'https://notyoutube.com/', 'https://www.youtube-nocookie.com/embed/x',
    'filo://newtab/', 'javascript:alert(1)', '', null, 'https://evil.example/?u=https://www.youtube.com/']) {
    assert.equal(A.hostConClicVero(u), false, String(u));
  }
});

test('il clic vero solo dal frame principale di una scheda', () => {
  const main = { frameTreeNodeId: 1, url: 'https://www.youtube.com/watch?v=x' };
  const wc = { mainFrame: main };
  const tab = { id: 7 };
  assert.equal(A.mittenteConClicVero({ wc, frame: main, tab }), true);
  assert.equal(A.mittenteConClicVero({ wc, frame: { frameTreeNodeId: 2, url: main.url }, tab }), false, 'un riquadro');
  assert.equal(A.mittenteConClicVero({ wc, frame: main, tab: null }), false, 'una finestra che non è una scheda');
  assert.equal(A.mittenteConClicVero({ wc, frame: { frameTreeNodeId: 1, url: 'https://evil.example/' }, tab }), false);
  assert.equal(A.mittenteConClicVero(null), false);
});

test('il punto: px CSS per lo zoom della scheda, dentro la vista, altrimenti niente', () => {
  assert.deepEqual(A.puntoNellaVista({ x: 100, y: 50 }, 1, 800, 600), { x: 100, y: 50 });
  assert.deepEqual(A.puntoNellaVista({ x: 100.4, y: 50.6 }, 1.5, 800, 600), { x: 151, y: 76 });
  assert.equal(A.puntoNellaVista({ x: 600, y: 10 }, 1.5, 800, 600), null, 'fuori a destra dopo lo zoom');
  assert.equal(A.puntoNellaVista({ x: -1, y: 10 }, 1, 800, 600), null);
  for (const bad of [{}, { x: 'a', y: 1 }, { x: NaN, y: 1 }, { x: Infinity, y: 1 }, null]) {
    assert.equal(A.puntoNellaVista(bad, 1, 800, 600), null, JSON.stringify(bad));
  }
});

function finta() {
  const eventi = [];
  return { eventi, isDestroyed: () => false, getZoomFactor: () => 1, sendInputEvent: (e) => eventi.push(e) };
}
const vista = { getBounds: () => ({ x: 0, y: 80, width: 800, height: 600 }) };

test('un clic vero è movimento, pressione e rilascio nello stesso punto', () => {
  const wc = finta();
  assert.deepEqual(A.clicVero(wc, { x: 10, y: 20 }, { view: vista, ora: 1e6 }), { ok: true });
  assert.deepEqual(wc.eventi.map((e) => [e.type, e.x, e.y]), [['mouseMove', 10, 20], ['mouseDown', 10, 20], ['mouseUp', 10, 20]]);
  assert.equal(wc.eventi[1].button, 'left');
});

test('due clic veri sulla stessa scheda distano almeno l\'intervallo', () => {
  const wc = finta();
  assert.equal(A.clicVero(wc, { x: 1, y: 1 }, { view: vista, ora: 1e6 }).ok, true);
  assert.equal(A.clicVero(wc, { x: 1, y: 1 }, { view: vista, ora: 1e6 + A.INTERVALLO_MS - 1 }).code, 'presto');
  assert.equal(A.clicVero(wc, { x: 1, y: 1 }, { view: vista, ora: 1e6 + A.INTERVALLO_MS }).ok, true);
  const altra = finta();
  assert.equal(A.clicVero(altra, { x: 1, y: 1 }, { view: vista, ora: 1e6 + 1 }).ok, true, 'un\'altra scheda ha il suo conto');
  assert.equal(A.clicVero(finta(), { x: 900, y: 1 }, { view: vista, ora: 1e6 }).code, 'punto');
  assert.equal(wc.eventi.length, 6);
});

test('l\'interruttore cambiato si dice alle schede, una volta', () => {
  A.configureFromSettings({ security: { adSkip: { enabled: true } } });
  assert.equal(A.configureFromSettings({ security: { adSkip: { enabled: true } } }), false);
  assert.equal(A.configureFromSettings({ security: { adSkip: { enabled: false } } }), true);
  assert.equal(A.configureFromSettings({ security: { adSkip: { enabled: false } } }), false);
  assert.equal(A.configureFromSettings({}), true);
  // La spinta deve poter raggiungere i content script dei siti.
  assert.ok(W.messaggioPerDestinazione({ type: 'ad_skip_config_update' }, 'https://www.youtube.com/', 'https://www.youtube.com/'));
});

test('dalla chat si accende e si spegne subito, senza conferma', () => {
  const off = globalThis.SN_PREF.buildPreferencePartial('salta_pubblicita', 'off');
  assert.deepEqual(off.partial, { security: { adSkip: { enabled: false } } });
  assert.equal(off.level, 1);
  assert.deepEqual(globalThis.SN_PREF.buildPreferencePartial('salta pubblicità', 'sì').partial, { security: { adSkip: { enabled: true } } });
  assert.equal(globalThis.SN_PREF.buildPreferencePartial('salta_pubblicita', 'boh'), null);
});

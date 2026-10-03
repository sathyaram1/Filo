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

// Una pagina con dentro `livelli` riquadri uno nell'altro, l'ultimo il lettore all'indirizzo dato.
function annidati(urlLettore, origini = []) {
  const main = { frameTreeNodeId: 1, url: 'https://blog.example/articolo', origin: 'https://blog.example' };
  let padre = main;
  for (const [i, o] of origini.entries()) padre = { frameTreeNodeId: 10 + i, url: o + '/x', origin: o, parent: padre };
  const lettore = { frameTreeNodeId: 5, url: urlLettore, origin: new URL(urlLettore).origin, parent: padre };
  return { wc: { mainFrame: main }, tab: { id: 7 }, frame: lettore };
}

test('il lettore di YouTube incorporato, anche dentro altri riquadri: ogni anello ha un\'origine vera', () => {
  assert.equal(A.modoClicVero(annidati('https://www.youtube.com/embed/x')), 'riquadro');
  assert.equal(A.modoClicVero(annidati('https://www.youtube-nocookie.com/embed/x')), 'riquadro');
  assert.equal(A.modoClicVero(annidati('https://www.youtube.com/embed/x', ['https://cdn.incorpora.example'])), 'riquadro');
  assert.equal(A.modoClicVero(annidati('https://evil.example/embed/x')), null);
  const s = annidati('https://www.youtube.com/embed/x', ['https://cdn.incorpora.example']);
  assert.deepEqual(A.catena(s).map((a) => [a.frame.frameTreeNodeId, a.origineFiglio]),
    [[10, 'https://www.youtube.com'], [1, 'https://cdn.incorpora.example']]);
  // Un'origine opaca la può avere anche un riquadro del sito chiuso in una sandbox: non si distingue.
  assert.equal(A.modoClicVero(annidati('https://www.youtube.com/embed/x', ['null'])), null);
  const profondo = annidati('https://www.youtube.com/embed/x', Array.from({ length: 12 }, (_, i) => `https://l${i}.example`));
  assert.equal(A.modoClicVero(profondo), null, 'una catena senza fine non si percorre');
  const { wc, tab } = annidati('https://www.youtube.com/embed/x');
  assert.equal(A.modoClicVero({ wc, tab, frame: wc.mainFrame }), null, 'la pagina ospite non è YouTube');
  assert.equal(A.modoClicVero({ ...annidati('https://www.youtube.com/embed/x'), tab: null }), null);
  assert.equal(A.hostIncorporato('https://youtube-nocookie.com.evil.example/'), false);
});

test('il clic dal riquadro parte solo se ogni frame sopra conferma il punto, dal più vicino alla pagina', async () => {
  const s = annidati('https://www.youtube.com/embed/x', ['https://cdn.incorpora.example']);
  const eventi = [];
  const debuggerFinto = { isAttached: () => false, attach() {}, detach() {}, sendCommand: async (c, p) => { eventi.push([p.type, p.x, p.y]); } };
  s.wc = Object.assign(s.wc, { isDestroyed: () => false, getZoomFactor: () => 1, debugger: debuggerFinto, sendInputEvent() {} });
  const dove = { view: vista };
  const domande = [];
  const chiedi = (risposte) => async (wc, frame, q) => { domande.push([frame.frameTreeNodeId, q]); return risposte.shift(); };
  const r = await A.clicDalRiquadro(s, { x: 10, y: 20, tag: 'aa' }, dove, {
    chiedi: chiedi([{ x: 16, y: 26, tag: 'bb' }, { x: 116, y: 226, tag: 'cc' }]), ora: 5e6,
  });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(domande, [
    [10, { tag: 'aa', origine: 'https://www.youtube.com', x: 10, y: 20 }],
    [1, { tag: 'bb', origine: 'https://cdn.incorpora.example', x: 16, y: 26 }],
  ]);
  assert.deepEqual(eventi[1], ['mousePressed', 116, 226]);
  for (const [risposte, code] of [[[{ no: 'coperto' }], 'coperto'], [[{ x: 1, y: 1, tag: 'b' }, { no: 'ignoto' }], 'ignoto'], [[null], 'tempo']]) {
    eventi.length = 0;
    const r2 = await A.clicDalRiquadro(s, { x: 10, y: 20, tag: 'aa' }, dove, { chiedi: chiedi(risposte), ora: 9e6 });
    assert.equal(r2.code, code);
    assert.equal(eventi.length, 0, 'nessun clic');
  }
  assert.equal((await A.clicDalRiquadro(s, { x: 10, y: 20 }, dove, { chiedi: chiedi([]), ora: 9e6 })).code, 'punto', 'senza il nome del lettore');
});

test('alla domanda del main risponde solo il frame interrogato', () => {
  const main = { frameTreeNodeId: 1, url: 'https://blog.example/', origin: 'https://blog.example' };
  const inviati = [];
  main.send = (canale, m) => inviati.push(m);
  const wc = { mainFrame: main };
  // La domanda parte davvero dal main verso quel frame soltanto; la risposta la sblocca.
  const s = { wc, tab: { id: 1 }, frame: { frameTreeNodeId: 5, url: 'https://www.youtube.com/embed/x', origin: 'https://www.youtube.com', parent: main } };
  const attesa = A.clicDalRiquadro(s, { x: 1, y: 1, tag: 'aa' }, { view: vista }, { ora: 2e7 });
  return Promise.resolve().then(async () => {
    const id = inviati[0].id;
    assert.equal(inviati[0].type, 'ad_skip_where');
    assert.equal(A.rispostaDalFrame({ wc, frame: { frameTreeNodeId: 5 } }, { id, x: 1, y: 1, tag: 'zz' }), false, 'il riquadro stesso');
    assert.equal(A.rispostaDalFrame({ wc: { mainFrame: main }, frame: main }, { id, x: 1, y: 1, tag: 'zz' }), false, 'un\'altra scheda');
    assert.equal(A.rispostaDalFrame({ wc, frame: main }, { id: 'inventato', x: 1, y: 1, tag: 'zz' }), false);
    assert.equal(A.rispostaDalFrame({ wc, frame: main }, { id, code: 'coperto' }), true);
    assert.equal((await attesa).code, 'coperto');
    assert.equal(A.rispostaDalFrame({ wc, frame: main }, { id, x: 1, y: 1, tag: 'zz' }), false, 'una risposta vale una volta');
  });
});

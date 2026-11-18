// #2372 — il doppio tocco di una lettera nella home (src/shared/doppioTocco.js): assegnazioni, frase della chat e
// riconoscimento battuta per battuta. Senza Electron: la home vera la prova tests/home-tastiera.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/constants.js');
require('../../src/shared/carteHome.js');
require('../../src/shared/doppioTocco.js');
require('../../src/shared/preferences.js');

const D = globalThis.SN_DOPPIO_TOCCO;
const P = globalThis.SN_PREF;

test('di serie nessuna lettera fa niente, e la soglia sta nei suoi limiti', () => {
  assert.deepEqual(D.normalizza(globalThis.SN_CONST.DEFAULT_SETTINGS.doppioTocco), { sogliaMs: 350, lettere: [] });
  assert.equal(D.normalizza({ sogliaMs: 5 }).sogliaMs, 100);
  assert.equal(D.normalizza({ sogliaMs: 99999 }).sogliaMs, 1000);
  assert.equal(D.normalizza({ sogliaMs: 'boh' }).sogliaMs, 350);
});

test('una lettera ha un’azione sola, un tasto una lettera sola; «w» si può dare', () => {
  let cfg = { lettere: [] };
  cfg = D.assegna(cfg, 'y', { url: 'youtube.com' });
  assert.deepEqual(cfg.lettere, [{ lettera: 'y', url: 'https://youtube.com/' }]);
  cfg = D.assegna(cfg, 'Y', { tasto: 'editor' });
  assert.deepEqual(cfg.lettere, [{ lettera: 'y', tasto: 'editor' }]);
  cfg = D.assegna(cfg, 'e', { tasto: 'editor' });
  assert.deepEqual(cfg.lettere, [{ lettera: 'e', tasto: 'editor' }], 'cambiare lettera a un tasto non lascia quella vecchia');
  cfg = D.assegna(cfg, 'w', { tasto: 'cerca' });
  assert.equal(D.diLettera(cfg, 'w').tasto, 'cerca');
  assert.equal(D.diTasto(cfg, 'cerca').lettera, 'w');
  assert.ok(D.assegna(cfg, 'ab', { tasto: 'cerca' }).rifiuto);
  assert.ok(D.assegna(cfg, '1', { tasto: 'cerca' }).rifiuto);
  assert.ok(D.assegna(cfg, 'k', { url: 'javascript:alert(1)' }).rifiuto, 'un indirizzo che esegue codice non si apre');
  assert.ok(D.assegna(cfg, 'k', { tasto: 'suggerimenti' }).rifiuto, 'una carta senza app non ha dove portare');
  assert.deepEqual(D.togli(cfg, 'e').lettere.map((v) => v.lettera), ['w']);
  // Dal disco: voci rotte o doppie cadono.
  assert.deepEqual(D.normalizza({ lettere: [{ lettera: 'y', url: 'https://a.it' }, { lettera: 'y', url: 'https://b.it' }, { lettera: 'zz' }, null] }).lettere,
    [{ lettera: 'y', url: 'https://a.it/' }]);
});

test('la chat assegna e toglie una lettera a parole, con le impostazioni di adesso', () => {
  const attuali = { doppioTocco: { lettere: [{ lettera: 'e', tasto: 'editor' }] } };
  const yt = P.buildPreferencePartial('doppio tocco', 'yy apre youtube.com', { attuali });
  assert.deepEqual(yt.partial.doppioTocco.lettere, [{ lettera: 'e', tasto: 'editor' }, { lettera: 'y', url: 'https://youtube.com/' }]);
  assert.match(yt.label, /yy → youtube\.com/);
  const imp = P.buildPreferencePartial('doppio tocco', 'i: il tasto delle impostazioni', { attuali });
  assert.deepEqual(imp.partial.doppioTocco.lettere.at(-1), { lettera: 'i', tasto: 'impostazioni' });
  assert.deepEqual(P.buildPreferencePartial('doppio tocco', 'c cerca nel filo', { attuali }).partial.doppioTocco.lettere.at(-1), { lettera: 'c', tasto: 'cerca' });
  const via = P.buildPreferencePartial('doppio tocco', 'togli e', { attuali });
  assert.deepEqual(via.partial.doppioTocco.lettere, []);
  assert.ok(P.buildPreferencePartial('doppio tocco', 'togli q', { attuali }).rifiuto);
  assert.ok(P.buildPreferencePartial('doppio tocco', 'y boh', { attuali }).rifiuto);
  assert.equal(P.buildPreferencePartial('soglia doppio tocco', '0,5 s').partial.doppioTocco.sogliaMs, 500);
  assert.equal(P.buildPreferencePartial('pausa ricerca', '800').partial.ricercaFilo.pausaMs, 800);
  assert.ok(P.buildPreferencePartial('pausa ricerca', '9000').rifiuto);
});

test('scatta solo con due lettere uguali come prime battute, entro la soglia, senza la ripetizione del tasto tenuto', () => {
  const cfg = { sogliaMs: 300, lettere: [{ lettera: 'y', url: 'https://youtube.com/' }] };
  const b = (key, t, o = {}) => ({ key, t, repeat: false, mod: false, vuoto: true, ...o });

  let r = D.riconoscitore();
  assert.equal(r.battuta(b('y', 0), cfg), 'trattieni');
  assert.deepEqual(r.battuta(b('y', 120, { vuoto: true }), cfg), { scatta: cfg.lettere[0] });

  r = D.riconoscitore();
  assert.equal(r.battuta(b('a', 0), cfg), null, 'una lettera senza azione si scrive');
  assert.equal(r.battuta(b('y', 50, { vuoto: false }), cfg), null, '«ay»: la y non è la prima battuta');
  assert.equal(r.battuta(b('y', 90, { vuoto: false }), cfg), null);

  r = D.riconoscitore();
  assert.equal(r.battuta(b('y', 0), cfg), 'trattieni');
  assert.equal(r.battuta(b('y', 500), cfg), 'lascia', 'oltre la soglia è testo');

  r = D.riconoscitore();
  assert.equal(r.battuta(b('y', 0), cfg), 'trattieni');
  assert.equal(r.battuta(b('y', 30, { repeat: true }), cfg), 'lascia', 'la ripetizione del tasto tenuto non è una seconda pressione');
  assert.equal(r.battuta(b('y', 60, { repeat: true, vuoto: false }), cfg), null);

  r = D.riconoscitore();
  assert.equal(r.battuta(b('y', 0), cfg), 'trattieni');
  assert.equal(r.battuta(b('e', 40), cfg), 'lascia', '«ye…» scrive la y e poi la e');

  r = D.riconoscitore();
  assert.equal(r.battuta(b('y', 0, { mod: true }), cfg), null, 'Ctrl+Y non è una lettera');
  assert.equal(r.battuta(b('y', 0), { lettere: [] }), null, 'di serie niente');
  assert.equal(r.lascia(), '');
});

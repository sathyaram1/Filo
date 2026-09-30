// #430 — le anteprime delle schede: la foto della scheda che va dietro, quella della scheda nata dietro (allargata
// sotto quella davanti e mai lasciata allargata), e la preferenza a parole. Viste finte: niente Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { AnteprimeSchede } = require(join(ROOT, 'src', 'main', 'tabs', 'anteprime.js'));
globalThis.SN_CONST = globalThis.SN_CONST || { testoLeggibile: (v) => String(v || '') };
require(join(ROOT, 'src', 'shared', 'preferences.js'));

function immagine(vuota = false) {
  const img = {
    isEmpty: () => vuota,
    getSize: () => ({ width: 1280, height: 720 }),
    crop: () => img,
    resize: () => img,
    toJPEG: () => Buffer.from('jpeg'),
  };
  return img;
}

function scheda(id, { disegnata = true } = {}) {
  return {
    id, loading: false, bounds: null,
    view: {
      setBounds(b) { this.bounds = b; },
      webContents: { isDestroyed: () => false, capturePage: async () => immagine(!disegnata) },
    },
  };
}

function manager(tabs, activeId) {
  const figli = [];
  const m = {
    tabs, activeId, _attivaNascosta: false, layouts: 0,
    win: {
      isDestroyed: () => false, isVisible: () => true, isMinimized: () => false,
      contentView: { addChildView: (v, i) => { figli.splice(figli.indexOf(v) >>> 0, figli.includes(v) ? 1 : 0); figli.splice(i ?? figli.length, 0, v); } },
    },
    figli,
    layout() {
      m.layouts++;
      for (const t of tabs) t.view.bounds = (t.id === m.activeId || m.anteprime.inCattura(t)) ? 'piena' : 'zero';
    },
  };
  return m;
}

const aspetta = (cond, ms = 3000) => new Promise((ok, ko) => {
  const fine = Date.now() + ms;
  const giro = () => (cond() ? ok() : Date.now() > fine ? ko(new Error('scaduto')) : setTimeout(giro, 20));
  giro();
});

test('la scheda che va dietro lascia la sua foto, e chi la riceve la sa', async () => {
  const a = scheda('a');
  const m = manager([a], 'a');
  const arrivate = [];
  m.anteprime = new AnteprimeSchede(m, { suNuova: (id) => arrivate.push(id) });
  m.anteprime.congeda(a);
  await aspetta(() => m.anteprime.get('a'));
  assert.match(m.anteprime.get('a').src, /^data:image\/jpeg;base64,/);
  assert.deepEqual(arrivate, ['a']);
});

test('la scheda nata dietro si fotografa sotto quella davanti e torna a zero', async () => {
  const davanti = scheda('d');
  const dietro = scheda('b');
  const m = manager([davanti, dietro], 'd');
  m.anteprime = new AnteprimeSchede(m);
  m.anteprime.nataDietro(dietro);
  assert.equal(m.anteprime.tieneSveglia(dietro), true);
  m.anteprime.caricata(dietro);
  await aspetta(() => m.anteprime.inCattura(dietro));
  assert.equal(m.figli[0], dietro.view, 'va in fondo alle viste, sotto quella davanti');
  assert.equal(dietro.view.bounds, 'piena');
  await aspetta(() => m.anteprime.get('b'));
  assert.equal(dietro.view.bounds, 'zero');
  assert.equal(m.anteprime.tieneSveglia(dietro), false);
});

test('se la scheda davanti si nasconde a metà, quella di dietro non resta allargata', async () => {
  const davanti = scheda('d');
  const dietro = scheda('b', { disegnata: false });
  const m = manager([davanti, dietro], 'd');
  m.anteprime = new AnteprimeSchede(m);
  m.anteprime.nataDietro(dietro);
  m.anteprime.caricata(dietro);
  await aspetta(() => m.anteprime.inCattura(dietro));
  m._attivaNascosta = true;
  m.anteprime.interrompi();
  assert.equal(m.anteprime.inCattura(dietro), false);
  assert.equal(dietro.view.bounds, 'zero');
  m.anteprime.chiudi();
});

test('una scheda chiusa porta via la sua foto', async () => {
  const a = scheda('a');
  const m = manager([a], 'a');
  const tolte = [];
  m.anteprime = new AnteprimeSchede(m, { suTolte: (ids) => tolte.push(...ids) });
  m.anteprime.congeda(a);
  await aspetta(() => m.anteprime.get('a'));
  m.tabs.length = 0;
  m.anteprime.pota(new Set());
  assert.equal(m.anteprime.get('a'), null);
  assert.deepEqual(tolte, ['a']);
});

test('a parole: si spegne, si riaccende a una misura, e le chiavi vaghe restano di chi le aveva', () => {
  const P = globalThis.SN_PREF;
  assert.deepEqual(P.buildPreferencePartial('anteprima_schede', 'no').partial, { tabPreview: { enabled: false } });
  assert.deepEqual(P.buildPreferencePartial('anteprima delle schede', 'più grande').partial, { tabPreview: { enabled: true, size: 'grande' } });
  assert.deepEqual(P.buildPreferencePartial('anteprima_schede', 'piccola').partial, { tabPreview: { enabled: true, size: 'piccola' } });
  assert.equal(P.buildPreferencePartial('anteprima_schede', 'boh'), null);
  assert.ok(P.buildPreferencePartial('tab', 'vivaci').partial.tabColor);
  assert.ok(P.buildPreferencePartial('schede', 'sì').partial.autoArchive);
});

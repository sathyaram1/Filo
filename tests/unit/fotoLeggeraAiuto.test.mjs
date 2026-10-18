// #1142 — la foto che l'Aiuto manda al modello a ogni passo esce ai pixel che l'utente vede, in JPEG; chi non la chiede
// leggera (Screenshot, feedback, ritaglio) la riceve come prima, PNG a pixel fisici. La prova vera sui pixel e sul peso è
// tests/aiuto-foto-leggera.spec.mjs: qui il gestore, con un'immagine finta e uno schermo al 125%.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';

const require = createRequire(import.meta.url);

const schermo = { scaleFactor: 1.25, chiesto: null };
const origLoad = Module._load;
Module._load = function finto(request, parent, isMain) {
  if (request === 'electron') {
    return {
      screen: {
        getDisplayMatching: (b) => { schermo.chiesto = b; return { scaleFactor: schermo.scaleFactor }; },
        getPrimaryDisplay: () => ({ scaleFactor: schermo.scaleFactor }),
      },
      app: { getPath: () => '', getVersion: () => '0.0.0', isPackaged: false },
      BrowserWindow: { getAllWindows: () => [] },
    };
  }
  return origLoad.call(this, request, parent, isMain);
};
process.on('exit', () => { Module._load = origLoad; });

require('../../src/shared/constants.js');
require('../../src/shared/messages.js');
const { MSG } = globalThis.SN_MSG;
const Foto = require('../../src/main/services/fotoDellaPagina.js');

function gestore() {
  const gestori = new Map();
  require('../../src/main/services/handlers/misc.js')((tipo, fn) => gestori.set(tipo, fn), {
    MSG, winOf: () => null, modelGate: {}, broadcastToTabs: () => {}, controllaUscita: () => {}, apriDaFilo: () => {},
  });
  return gestori.get(MSG.CAPTURE_VISIBLE_TAB);
}

// Una PNG di 2400×1350 a pixel fisici, come la dà capturePage() sullo schermo al 125%; i JPEG portano la firma vera.
function immagineFinta(width = 2400, height = 1350, registro = []) {
  return {
    getSize: () => ({ width, height }),
    toDataURL: () => { registro.push('png'); return 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024); },
    resize: (o) => { registro.push(['resize', o]); return immagineFinta(o.width, o.height, registro); },
    toJPEG: (q) => { registro.push(['jpeg', q, width, height]); return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(300 * 1024)]); },
  };
}

function mittente(img) {
  const win = { isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }) };
  win._filoTabs = { activeId: 1, tabs: [{ id: 1, view: { webContents: { capturePage: async () => img } } }] };
  return { isShell: true, win };
}

const gestisci = gestore();

test('con leggera: JPEG a 1920×1080 dallo schermo al 125%, sotto 500 KB, qualità 85', async () => {
  const registro = [];
  const r = await gestisci({ type: MSG.CAPTURE_VISIBLE_TAB, leggera: true }, mittente(immagineFinta(2400, 1350, registro)));
  assert.equal(r.ok, true);
  assert.match(r.dataUrl, /^data:image\/jpeg;base64,\/9j\//);
  assert.deepEqual(registro, [['resize', { width: 1920, height: 1080, quality: 'best' }], ['jpeg', 85, 1920, 1080]]);
  assert.ok(r.dataUrl.length < 500 * 1024, `data URL di ${r.dataUrl.length} caratteri`);
  assert.deepEqual(schermo.chiesto, { x: 0, y: 0, width: 1920, height: 1080 }, 'il fattore è quello dello schermo della finestra');
});

test('senza l\'opzione la cattura resta quella di prima: PNG a pixel fisici, niente riduzione', async () => {
  for (const msg of [{ type: MSG.CAPTURE_VISIBLE_TAB }, { type: MSG.CAPTURE_VISIBLE_TAB, leggera: 'sì' }]) {
    const registro = [];
    const r = await gestisci(msg, mittente(immagineFinta(2400, 1350, registro)));
    assert.equal(r.ok, true);
    assert.match(r.dataUrl, /^data:image\/png;base64,/);
    assert.deepEqual(registro, ['png']);
  }
});

test('sullo schermo al 100% non si ridimensiona, si comprime e basta', async () => {
  schermo.scaleFactor = 1;
  try {
    const registro = [];
    const r = await gestisci({ type: MSG.CAPTURE_VISIBLE_TAB, leggera: true }, mittente(immagineFinta(1920, 1080, registro)));
    assert.match(r.dataUrl, /^data:image\/jpeg;base64,/);
    assert.deepEqual(registro, [['jpeg', 85, 1920, 1080]]);
  } finally { schermo.scaleFactor = 1.25; }
});

test('una foto vuota non parte come immagine: l\'Aiuto prosegue senza', async () => {
  const r = await gestisci({ type: MSG.CAPTURE_VISIBLE_TAB, leggera: true }, mittente(immagineFinta(0, 0)));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'vuota');
});

test('il fattore di scala: quello dello schermo, 1 se non si sa o se è assurdo', () => {
  const win = { isDestroyed: () => false, getBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }) };
  assert.equal(Foto.fattoreDiScala({ win }, { getDisplayMatching: () => ({ scaleFactor: 2 }) }), 2);
  assert.equal(Foto.fattoreDiScala({}, { getPrimaryDisplay: () => ({ scaleFactor: 1.5 }) }), 1.5);
  assert.equal(Foto.fattoreDiScala({ win }, { getDisplayMatching: () => ({ scaleFactor: 0 }) }), 1);
  assert.equal(Foto.fattoreDiScala({ win }, { getDisplayMatching: () => { throw new Error('app non pronta'); } }), 1);
  assert.equal(Foto.fattoreDiScala({ win: { isDestroyed: () => true } }, { getPrimaryDisplay: () => ({ scaleFactor: 1.25 }) }), 1.25);
});

test('i lati dispari si arrotondano e non scendono sotto un pixel', () => {
  const registro = [];
  Foto.fotoLeggera(immagineFinta(2401, 1, registro), 1.25);
  assert.deepEqual(registro[0], ['resize', { width: 1921, height: 1, quality: 'best' }]);
});

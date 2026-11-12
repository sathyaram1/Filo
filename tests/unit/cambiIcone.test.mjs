// #867.1 — spostare un'icona della barra laterale è un cambio del filo: si legge, si annulla da solo, e
// «rimetti come prima» non tocca gli altri cambi. Qui la logica pura e il registro con lo storage vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const userData = cartellaTemporanea('filo-cambi-icone-');
process.env.FILO_USER_DATA = userData;
// Una disposizione salvata prima del #1246, con la riga del tasto destro: la sua migrazione non è un cambio di nessuno.
writeFileSync(join(userData, 'storage.json'), JSON.stringify({
  sn_icon_layout: {
    primary: ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab'],
    secondary: ['openOptions', 'editorApp', 'feedbackApp', 'screenshotCrop', 'transcribe', 'colorPicker', 'fullscreen'],
    bar: ['help', 'back', 'forward', 'reload', 'home', 'incognito', 'closeTab'],
  },
}));

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: { getAllWindows: () => [] } };
  }
  return origLoad.call(this, request, parent, isMain);
};

const Disco = require(join(ROOT, 'src', 'main', 'shim', 'storage.js'));
globalThis.self = globalThis;
globalThis.chrome = { storage: { local: { get: Disco.get, set: Disco.set, remove: Disco.remove } } };
for (const m of ['constants', 'i18n', 'contenutoEsterno', 'timeFormat', 'storage', 'themeTokens', 'tabColor', 'ttsVoices', 'filoMemory', 'preferences', 'disposizioneIcone', 'cambi', 'filoEventi']) {
  require(join(ROOT, 'src', 'shared', `${m}.js`));
}
const Registro = require(join(ROOT, 'src', 'main', 'services', 'registroCambi.js'));
const Layout = require(join(ROOT, 'src', 'main', 'services', 'layoutIcone.js'));
const D = globalThis.SN_DISPOSIZIONE_ICONE;
const C = globalThis.SN_CAMBI;
Registro.collega({ disposizioneIcone: (cambia, o) => Layout.riscrivi(cambia, o) });
Registro.avvia();

// Dalla porta del registro, non dal posto dove tiene i cambi: quel posto è già cambiato una volta (#1561).
async function eventi(tipo) {
  await Registro.attesa();
  return (await Registro.lista()).filter((e) => !tipo || e.tipo === tipo);
}
const dallaBarra = (fn) => Registro.con({ via: 'interfaccia', dove: 'barra' }, fn);
// Dove sta rispetto alle vicine: il posto in numeri cambia se un'altra icona si sposta sopra di lei.
const vicina = (l, id) => { const p = D.posizione(l, id); return p && { zona: p.zona, davanti: p.davanti }; };

test('la frase dice quale icona e dove: nella stessa zona i posti, fra barra e «Altro…» le zone', () => {
  const prima = D.migra(undefined).layout;
  const su = D.applicaPosa(prima, { id: 'qrCode', target: 'bar', beforeId: 'back' });
  const cambi = C.cambiIcone(prima, su, { mossa: 'qrCode' });
  assert.deepEqual(cambi.map((c) => c.chiave), ['icona:qrCode']);
  assert.match(C.fraseCambio(cambi[0]), /^icona «QR code della pagina» nella barra laterale: 13° posto → 2° posto$/);
  const via = D.applicaPosa(prima, { id: 'share', target: 'secondary', beforeId: null });
  assert.equal(C.fraseCambio(C.cambiIcone(prima, via)[0]), 'icona «Condividi»: barra laterale → «Altro…» della barra laterale');
  // Non chiede conferma ed è annullabile: è lo stesso gesto del trascinamento.
  assert.equal(C.livello({ cambi }), 1);
  assert.equal(C.annullabile({ cambi }), true);
  assert.deepEqual(C.cambiIcone(prima, prima), []);
});

test('annullare rimette solo l\'icona di quel cambio: quelle spostate dopo restano dove sono', () => {
  const a = D.migra(undefined).layout;
  const b = D.applicaPosa(a, { id: 'qrCode', target: 'bar', beforeId: 'back' });
  const cambio = { cambi: C.cambiIcone(a, b, { mossa: 'qrCode' }) };
  const c = D.applicaPosa(b, { id: 'translate', target: 'secondary', beforeId: null });
  const rimessa = C.annulloIcone(cambio, c);
  assert.deepEqual(vicina(rimessa, 'qrCode'), vicina(a, 'qrCode'));
  assert.equal(D.posizione(rimessa, 'translate').zona, 'secondary', 'lo spostamento dopo non si tocca');
  assert.deepEqual(C.annulloIcone(cambio, b), a);
});

test('la riga di prima che entra nella barra non è un cambio; uno spostamento dalla barra sì, e si annulla da solo', async () => {
  const migrata = await Layout.leggi();
  assert.deepEqual(migrata.bar.slice(-6), ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab']);
  assert.equal(migrata.primary, undefined);
  assert.deepEqual(await eventi('icone'), [], 'la migrazione non l\'ha chiesta nessuno');

  // Un altro cambio prima: «rimetti come prima» non deve toccarlo.
  await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' });
  await dallaBarra(() => Layout.posa({ id: 'qrCode', target: 'bar', beforeId: 'back' }));
  const [mossa] = await eventi('icone');
  assert.equal(mossa.via, 'interfaccia');
  assert.equal(C.provenienza(mossa), 'dalla barra laterale');
  assert.match(C.frase(mossa), /icona «QR code della pagina» nella barra laterale: 12° posto → 2° posto/);
  assert.deepEqual((await Layout.leggi()).bar.slice(0, 3), ['help', 'qrCode', 'back']);

  const r = await Registro.annulla(null, { via: 'chat' });
  assert.equal(r.ok, true);
  assert.equal(r.id, mossa.id, 'l\'ultimo cambio è lo spostamento, non il tema');
  assert.deepEqual((await Layout.leggi()).bar, migrata.bar);
  assert.equal((await globalThis.SN_STORAGE.getSettings()).theme, 'dark', 'il tema resta com\'era');
  const annullo = (await eventi('icone')).at(-1);
  assert.equal(annullo.annulla, mossa.id);
  assert.equal(C.provenienza(annullo), 'annullato dalla chat');

  // Annullare l'annullo lo rimette.
  const r2 = await Registro.annulla(annullo.id, { via: 'chat' });
  assert.equal(r2.ok, true);
  assert.deepEqual((await Layout.leggi()).bar.slice(0, 3), ['help', 'qrCode', 'back']);
});

test('due spostamenti di icone diverse sono due cambi, e annullare il primo lascia il secondo', async () => {
  const prima = await Layout.leggi();
  await dallaBarra(() => Layout.posa({ id: 'share', target: 'secondary', beforeId: null }));
  await dallaBarra(() => Layout.posa({ id: 'colorPicker', target: 'bar', beforeId: 'help' }));
  const ultimi = (await eventi('icone')).slice(-2);
  assert.deepEqual(ultimi.map((e) => e.cambi.map((c) => c.chiave)), [['icona:share'], ['icona:colorPicker']]);
  const r = await Registro.annulla(ultimi[0].id, { via: 'chat' });
  assert.equal(r.ok, true);
  const dopo = await Layout.leggi();
  assert.deepEqual(vicina(dopo, 'share'), vicina(prima, 'share'));
  assert.equal(dopo.bar[0], 'colorPicker', 'il secondo spostamento resta');
});

// Chi annulla legge questi tre testi: uno che non nomina le icone gli fa credere che il riordino non si rimetta così.
test('l\'annullo, i CAMBI RECENTI e il manifesto nominano le icone della barra laterale', () => {
  require(join(ROOT, 'src', 'shared', 'actionTools.js'));
  require(join(ROOT, 'src', 'shared', 'filoState.js'));
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  assert.match(globalThis.SN_ACTION_TOOLS.TOOLS.ANNULLA_CAMBIO.description, /icone della barra laterale/);
  const titolo = (globalThis.SN_FILO_STATE.sezioni.toString().match(/'CAMBI RECENTI[^']*'/) || [''])[0];
  assert.match(titolo, /icone della barra laterale/);
  const voce = globalThis.SN_CAPABILITIES.CAPABILITIES.find((c) => c.id === 'undo-changes');
  assert.match(voce.desc, /icone della barra laterale/);
});

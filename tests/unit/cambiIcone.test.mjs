// #867.1 — spostare un'icona della barra laterale cambiava lo stato senza lasciare un evento: «rimetti come prima»
// non lo vedeva e annullava il cambio precedente. Qui con lo storage vero e la porta unica della disposizione.

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
// La disposizione di chi aveva ancora la riga in cima al tasto destro: diventarne una della barra non è un cambio suo.
const conRiga = {
  primary: ['translate', 'screenshot'],
  secondary: ['openOptions', 'editorApp', 'feedbackApp', 'screenshotCrop', 'transcribe', 'colorPicker', 'share', 'saveForLater', 'qrCode', 'newTab'],
  bar: ['back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab'],
};
writeFileSync(join(userData, 'storage.json'), JSON.stringify({ sn_icon_layout: conRiga }));

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
for (const m of ['constants', 'i18n', 'contenutoEsterno', 'timeFormat', 'storage', 'themeTokens', 'tabColor', 'ttsVoices', 'filoMemory', 'preferences', 'disposizioneIcone', 'cambi']) {
  require(join(ROOT, 'src', 'shared', `${m}.js`));
}
const Registro = require(join(ROOT, 'src', 'main', 'services', 'registroCambi.js'));
const Layout = require(join(ROOT, 'src', 'main', 'services', 'layoutIcone.js'));
Registro.collega({ rimettiIcone: (calcola, opz) => Layout.cambia(calcola, opz) });
const FM = globalThis.SN_FILO_MEMORY;
const K = globalThis.SN_CONST.STORAGE_KEYS;
const C = globalThis.SN_CAMBI;
Registro.avvia();

async function eventi(tipo) {
  await Registro.attesa();
  const r = await Disco.get(K.FILO_CAMBI);
  return (r[K.FILO_CAMBI] || []).filter((e) => !tipo || e.tipo === tipo);
}
const dallaBarra = (fn) => Registro.con({ via: 'interfaccia', dove: 'barra' }, fn);
const salvata = async () => (await Disco.get(Layout.CHIAVE))[Layout.CHIAVE];

test('la riga che passa nella barra all\'aggiornamento non è un cambio di nessuno', async () => {
  const l = await Layout.leggi();
  assert.deepEqual(l.bar.slice(-2), ['translate', 'screenshot']);
  assert.deepEqual(l.primary, []);
  assert.deepEqual(await eventi('icone'), []);
});

test('un\'icona spostata nella barra è un evento suo, detto con i nomi, e «rimetti come prima» rimette lei e solo lei', async () => {
  await FM.setProxyRule('prima.example', { country: 'de' });
  const prima = await salvata();
  await dallaBarra(() => Layout.posa({ id: 'screenshot', target: 'bar', beforeId: 'home' }));
  const [ev] = await eventi('icone');
  assert.ok(ev, 'nessun evento per lo spostamento');
  assert.equal(ev.via, 'interfaccia');
  assert.equal(C.provenienza(ev), 'dalla barra laterale');
  assert.match(C.frase(ev), /^icona «[^»]+» spostata prima di «[^»]+» nella barra laterale$/);
  assert.doesNotMatch(C.frase(ev), /screenshot|home/, 'i nomi dell\'icona, non gli id');
  const { righe } = C.righePerModello(await eventi());
  assert.match(righe.at(-1), new RegExp(`${ev.id}: icona «`), 'il modello lo vede fra i CAMBI RECENTI, per ultimo');

  const r = await Registro.annulla(null, { via: 'chat' });
  assert.equal(r.ok, true);
  assert.equal(r.id, ev.id, 'annulla lo spostamento, non la regola del proxy di prima');
  assert.deepEqual(await salvata(), prima);
  assert.ok('prima.example' in (await FM.listProxyRules()), 'la regola del proxy resta');
  const annullo = (await eventi('icone')).at(-1);
  assert.equal(annullo.annulla, ev.id);
});

test('due spostamenti di fila sono due eventi: annullare l\'ultimo lascia il primo', async () => {
  await dallaBarra(() => Layout.posa({ id: 'qrCode', target: 'bar', beforeId: 'back' }));
  const dopoUno = await salvata();
  await dallaBarra(() => Layout.posa({ id: 'reload', target: 'secondary', beforeId: null }));
  const ultimi = (await eventi('icone')).slice(-2);
  assert.equal(ultimi.length, 2);
  assert.notEqual(ultimi[0].id, ultimi[1].id);
  assert.match(C.frase(ultimi[1]), /: dalla barra laterale ad «Altro…», in fondo$/);
  await Registro.annulla(null, { via: 'chat' });
  assert.deepEqual(await salvata(), dopoUno);
});

test('annullare uno spostamento vecchio rimette quell\'icona e non tocca quelle spostate dopo', async () => {
  await dallaBarra(() => Layout.posa({ id: 'share', target: 'bar', beforeId: 'forward' }));
  const vecchio = (await eventi('icone')).at(-1);
  await dallaBarra(() => Layout.posa({ id: 'newTab', target: 'bar', beforeId: 'back' }));
  const r = await Registro.annulla(vecchio.id, { via: 'interfaccia' });
  assert.equal(r.ok, true);
  const l = await salvata();
  assert.ok(l.secondary.includes('share') && !l.bar.includes('share'), '«Condividi» torna in «Altro…»');
  assert.equal(l.bar.indexOf('newTab'), l.bar.indexOf('back') - 1, 'quella spostata dopo resta dove l\'ha messa l\'utente');
  // E annullare l'annullo la rimette nella barra.
  const annullo = (await eventi('icone')).at(-1);
  await Registro.annulla(annullo.id, { via: 'interfaccia' });
  const rifatto = await salvata();
  assert.equal(rifatto.bar.indexOf('share'), rifatto.bar.indexOf('forward') - 1);
});

test('chiedere a Filo una disposizione uguale a quella di adesso non lascia niente', async () => {
  const n = (await eventi('icone')).length;
  const l = await salvata();
  await Layout.posa({ id: l.bar.at(-1), target: 'bar', beforeId: null });
  assert.equal((await eventi('icone')).length, n);
});

test('la prima posa di chi non si era mai disposto le icone è uno spostamento dalla disposizione di serie', () => {
  const D = globalThis.SN_DISPOSIZIONE_ICONE;
  const dopo = D.applicaPosa(D.DEFAULT, { id: 'home', target: 'bar', beforeId: 'back' });
  const cambi = C.cambiIcone(undefined, dopo);
  assert.equal(cambi.length, 1);
  const ev = { tipo: 'icone', cambi };
  assert.match(C.frase(ev), /^icona «[^»]+» spostata prima di «[^»]+» nella barra laterale$/);
  assert.deepEqual(C.annulloIcone(ev, dopo), { primary: [], secondary: [...D.DEFAULT.secondary], bar: [...D.DEFAULT.bar] });
});

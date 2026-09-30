// Barra laterale (#871): dove sta ogni icona, la migrazione di chi aveva già una disposizione, il
// tasto che la apre. Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'disposizioneIcone.js'));
require(join(ROOT, 'src', 'shared', 'tasti.js'));
const D = globalThis.SN_DISPOSIZIONE_ICONE;
const T = globalThis.SN_TASTI;

// La disposizione di chi non l'aveva mai toccata, prima della barra.
const VECCHIO_DEFAULT = {
  primary: ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab'],
  secondary: ['openOptions', 'home', 'editorApp', 'feedbackApp', 'incognito', 'screenshotCrop', 'transcribe', 'colorPicker', 'closeTab', 'fullscreen', 'back', 'forward', 'reload'],
};

test('«Altro…» non ha più le voci globali: stanno nella barra', () => {
  for (const id of D.GLOBALI) {
    assert.ok(D.DEFAULT.bar.includes(id), `${id} manca dalla barra`);
    assert.ok(!D.DEFAULT.secondary.includes(id), `${id} è ancora in «Altro…»`);
    assert.ok(!D.DEFAULT.primary.includes(id), `${id} è nella riga del tasto destro`);
  }
  assert.deepEqual(D.DEFAULT.bar.slice(0, 4), ['back', 'forward', 'reload', 'home']);
});

test('chi aveva la disposizione di prima ritrova le globali nella barra e il resto dov\'era', () => {
  const r = D.migra(VECCHIO_DEFAULT, { qrPromosso: true });
  assert.equal(r.scrivi, true);
  assert.deepEqual(r.layout.primary, VECCHIO_DEFAULT.primary);
  assert.deepEqual(r.layout.secondary, ['openOptions', 'editorApp', 'feedbackApp', 'screenshotCrop', 'transcribe', 'colorPicker']);
  assert.deepEqual(r.layout.bar, ['back', 'forward', 'reload', 'home', 'incognito', 'fullscreen', 'closeTab']);
});

test('chi aveva portato una globale nella riga la ritrova nella riga, e non perde niente', () => {
  const salvato = {
    primary: ['back', 'translate', 'reload'],
    secondary: ['forward', 'screenshot', 'share', 'saveForLater', 'qrCode', 'newTab', 'openOptions', 'home', 'editorApp', 'feedbackApp', 'incognito', 'screenshotCrop', 'transcribe', 'colorPicker', 'closeTab', 'fullscreen'],
  };
  const { layout } = D.migra(salvato, { qrPromosso: true });
  assert.deepEqual(layout.primary, ['back', 'translate', 'reload']);
  assert.deepEqual(layout.bar, ['forward', 'home', 'incognito', 'fullscreen', 'closeTab']);
  const prima = new Set([...salvato.primary, ...salvato.secondary]);
  const dopo = [...layout.primary, ...layout.secondary, ...layout.bar];
  assert.equal(dopo.length, new Set(dopo).size, 'un\'icona in due posti');
  for (const id of prima) assert.ok(dopo.includes(id), `${id} è sparita`);
});

test('una disposizione che ha già la barra non si tocca, e la migrazione è idempotente', () => {
  const r1 = D.migra(VECCHIO_DEFAULT, { qrPromosso: true });
  const r2 = D.migra(r1.layout, { qrPromosso: true });
  assert.equal(r2.scrivi, false);
  assert.deepEqual(r2.layout, r1.layout);
  const scelta = { primary: ['translate'], secondary: ['back'], bar: ['screenshot', 'forward'] };
  const r3 = D.migra(scelta, { qrPromosso: true });
  assert.deepEqual(r3.layout.bar.slice(0, 2), ['screenshot', 'forward']);
  assert.ok(r3.layout.secondary.includes('back'), 'indietro rimesso nel menu dall\'utente torna nella barra');
});

test('niente di salvato: la disposizione di serie, con la barra', () => {
  const r = D.migra(undefined, { qrPromosso: false });
  assert.deepEqual(r.layout, { primary: [...D.DEFAULT.primary], secondary: [...D.DEFAULT.secondary], bar: [...D.DEFAULT.bar] });
  assert.equal(r.segnaQr, true);
});

test('id sconosciuti, ritirati o doppi escono dal salvato', () => {
  const { layout } = D.migra({ primary: ['translate', 'translate', 'nonEsiste'], secondary: ['openForLater', '__proto__'], bar: ['back', 'translate'] }, { qrPromosso: true });
  const tutte = [...layout.primary, ...layout.secondary, ...layout.bar];
  assert.equal(tutte.filter((id) => id === 'translate').length, 1);
  for (const id of ['nonEsiste', 'openForLater', '__proto__']) assert.ok(!tutte.includes(id), id);
});

test('trascinare «schermata» nella barra la toglie dal menu, riportarla la toglie dalla barra', () => {
  const nella = D.applicaPosa(D.DEFAULT, { id: 'screenshot', target: 'bar', beforeId: 'home' });
  assert.ok(!nella.primary.includes('screenshot'));
  assert.equal(nella.bar.indexOf('screenshot'), nella.bar.indexOf('home') - 1);
  const riportata = D.applicaPosa(nella, { id: 'screenshot', target: 'primary', beforeId: null });
  assert.ok(!riportata.bar.includes('screenshot'));
  assert.ok(riportata.primary.includes('screenshot') || riportata.secondary.includes('screenshot'));
  assert.ok(riportata.primary.length <= D.MAX_PRIMARY);
});

test('una posa con un id o una zona che non esistono non scrive niente', () => {
  assert.equal(D.applicaPosa(D.DEFAULT, { id: 'nonEsiste', target: 'bar' }), null);
  assert.equal(D.applicaPosa(D.DEFAULT, { id: 'back', target: 'altrove' }), null);
  assert.equal(D.applicaPosa(D.DEFAULT, { id: '__proto__', target: 'bar' }), null);
});

test('le icone della barra si chiamano e si disegnano come nel menu del tasto destro', () => {
  const src = readFileSync(join(ROOT, 'src', 'content', 'menuIcons.js'), 'utf8');
  for (const [id, d] of Object.entries(D.ICONE)) {
    const riga = src.split('\n').find((l) => new RegExp(`\\bid:\\s*'${id}'`).test(l));
    assert.ok(riga, `${id} non è nel registro del menu`);
    if (id === 'translate' || id === 'fullscreen') continue; // etichetta e icona cambiano con lo stato
    assert.ok(riga.includes(`I18n.t('${d.etichetta}')`), `${id}: nel menu l'etichetta non è ${d.etichetta}`);
    assert.ok(riga.includes(`I('${d.icona}')`), `${id}: nel menu l'icona non è ${d.icona}`);
  }
});

test('il tasto della barra è di Filo: riservato, con Cmd su Mac, e mai Ctrl+B', () => {
  assert.equal(T.riservato('Ctrl+Shift+B', 'win32'), true);
  assert.equal(T.riservato('Ctrl+Shift+B', 'linux'), true);
  assert.equal(T.riservato('Cmd+Shift+B', 'darwin'), true);
  assert.equal(T.riservato('Ctrl+B', 'win32'), false, 'Ctrl+B è il grassetto: resta alle pagine');
  assert.equal(T.etichettaBarra('darwin'), 'Cmd+Shift+B');
  assert.equal(T.etichettaBarra('win32'), 'Ctrl+Shift+B');
  assert.equal(T.comandoBarra({ type: 'keyDown', control: true, shift: true, key: 'B', code: 'KeyB' }), true);
  assert.equal(T.comandoBarra({ type: 'keyDown', meta: true, shift: true, key: 'b', code: 'KeyB' }), true);
  assert.equal(T.comandoBarra({ ctrlKey: true, shiftKey: true, key: 'B' }), true);
  assert.equal(T.comandoBarra({ control: true, key: 'b', code: 'KeyB' }), false);
  assert.equal(T.comandoBarra({ control: true, shift: true, alt: true, key: 'B', code: 'KeyB' }), false);
  assert.equal(T.comandoBarra({ shift: true, key: 'B', code: 'KeyB' }), false);
});

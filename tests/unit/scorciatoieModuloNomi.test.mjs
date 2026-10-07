// #545.1: la scorciatoia di un modulo dell'Editor si scrive col nome che viene
// in mente e deve scattare quando quel tasto viene premuto. Nome scritto e tasto
// premuto passano da SN_TASTI; che il modulo si apra lo prova
// tests/audit-editor-module-shortcut.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'tasti.js'));
const T = globalThis.SN_TASTI;

const premi = (o) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

test('i tasti speciali scritti per nome scattano alla pressione', () => {
  const spazio = premi({ ctrlKey: true, key: ' ', code: 'Space' });
  for (const scritto of ['Ctrl+Space', 'ctrl+spazio', 'Ctrl + Spacebar']) {
    assert.equal(T.combacia(spazio, scritto), true, scritto);
  }
  const su = premi({ ctrlKey: true, key: 'ArrowUp', code: 'ArrowUp' });
  for (const scritto of ['Ctrl+Up', 'Ctrl+ArrowUp', 'Ctrl+Su', 'Ctrl+Freccia su', 'Ctrl+↑']) {
    assert.equal(T.combacia(su, scritto), true, scritto);
  }
  assert.equal(T.combacia(premi({ ctrlKey: true, key: 'ArrowDown' }), 'Ctrl+Giù'), true);
  assert.equal(T.combacia(premi({ ctrlKey: true, key: 'Escape', code: 'Escape' }), 'Ctrl+Esc'), true);
  assert.equal(T.combacia(premi({ ctrlKey: true, key: 'Enter' }), 'Ctrl+Invio'), true);
  assert.equal(T.combacia(premi({ ctrlKey: true, key: 'Delete' }), 'Ctrl+Canc'), true);
  assert.equal(T.combacia(premi({ altKey: true, key: 'F5', code: 'F5' }), 'Alt+F5'), true);
});

test('«Control» e «Cmd» contano come Ctrl anche alla pressione', () => {
  // Shift+2 scrive un simbolo diverso per ogni layout: conta il tasto fisico.
  const ctrl = premi({ ctrlKey: true, shiftKey: true, key: '"', code: 'Digit2' });
  const cmd = premi({ metaKey: true, shiftKey: true, key: '@', code: 'Digit2' });
  for (const scritto of ['Control+Shift+2', 'Cmd+Shift+2', 'Command+Shift+2', 'Ctrl+Shift+2']) {
    assert.equal(T.combacia(ctrl, scritto), true, scritto);
    assert.equal(T.combacia(cmd, scritto), true, scritto);
  }
  assert.equal(T.combacia(premi({ altKey: true, key: 'p', code: 'KeyP' }), 'Opt+P'), true);
});

test('un modificatore in più o in meno non scatta', () => {
  assert.equal(T.combacia(premi({ key: ' ', code: 'Space' }), 'Ctrl+Space'), false);
  assert.equal(T.combacia(premi({ ctrlKey: true, key: ' ' }), 'Ctrl+Shift+Space'), false);
  assert.equal(T.combacia(premi({ ctrlKey: true, altKey: true, key: 'ArrowUp' }), 'Ctrl+Up'), false);
  assert.equal(T.combacia(premi({ ctrlKey: true, key: 'ArrowDown' }), 'Ctrl+Up'), false);
});

test('un nome di tasto che non conosciamo si riconosce PRIMA di salvarlo', () => {
  for (const ok of ['Ctrl+Space', 'Ctrl+Shift+1', 'Ctrl+F12', 'Alt+Tab', 'Ctrl+Up', 'Ctrl+Pagegiù', 'Ctrl+è', 'Ctrl++']) {
    assert.equal(T.tastoRiconosciuto(ok), true, ok);
  }
  for (const ko of ['Ctrl+Spazioo', 'Ctrl+Uppp', 'Ctrl+F25', 'Ctrl']) {
    assert.equal(T.tastoRiconosciuto(ko), false, ko);
  }
});

test('i modificatori col nome italiano o col simbolo del Mac contano alla pressione', () => {
  const ctrlShift2 = premi({ ctrlKey: true, shiftKey: true, key: '"', code: 'Digit2' });
  for (const scritto of ['Ctrl+Maiusc+2', 'Controllo+Maiusc+2', '⌘+⇧+2', 'Comando+Shift+2']) {
    assert.equal(T.combacia(ctrlShift2, scritto), true, scritto);
    assert.equal(T.pezzoSconosciuto(scritto), null, scritto);
  }
  assert.equal(T.combacia(premi({ ctrlKey: true, key: '2', code: 'Digit2' }), 'Ctrl+Maiusc+2'), false);
  assert.equal(T.combacia(premi({ altKey: true, key: 'p', code: 'KeyP' }), 'Opzione+P'), true);
  assert.equal(T.combacia(premi({ altKey: true, key: 'p', code: 'KeyP' }), '⌥+P'), true);
});

test('un modificatore che non sappiamo premere si rifiuta invece di sparire', () => {
  for (const [scritto, nome] of [['Ctrl+AltGr+2', 'AltGr'], ['Ctrl+Win+2', 'Win'], ['Ctrl+Pippo+2', 'Pippo'], ['Fn+Ctrl+F1', 'Fn']]) {
    assert.deepEqual(T.pezzoSconosciuto(scritto), { nome, modificatore: true }, scritto);
  }
  assert.deepEqual(T.pezzoSconosciuto('Ctrl+Spazioo'), { nome: 'Spazioo', modificatore: false });
  for (const vuoto of ['', 'b', 'Ctrl+Shift+1', 'Ctrl++']) assert.equal(T.pezzoSconosciuto(vuoto), null, vuoto);
});

test('i nomi italiani dei tasti sulla tastiera si riconoscono', () => {
  const casi = [
    ['Ctrl+Barra spaziatrice', { key: ' ', code: 'Space' }],
    ['Ctrl+Pag Su', { key: 'PageUp', code: 'PageUp' }],
    ['Ctrl+PagSu', { key: 'PageUp', code: 'PageUp' }],
    ['Ctrl+Pag giù', { key: 'PageDown', code: 'PageDown' }],
    ['Ctrl+Pausa', { key: 'Pause', code: 'Pause' }],
    ['Ctrl+Menu', { key: 'ContextMenu', code: 'ContextMenu' }],
  ];
  for (const [scritto, tasto] of casi) {
    assert.equal(T.tastoRiconosciuto(scritto), true, scritto);
    assert.equal(T.combacia(premi({ ctrlKey: true, ...tasto }), scritto), true, scritto);
  }
  // Stamp lo cattura il sistema per l'istantanea: si rifiuta dicendolo.
  for (const p of ['win32', 'darwin', 'linux']) assert.equal(T.delSistema('Ctrl+Stamp', p), true, p);
});

test('le combinazioni che il sistema operativo si prende sono riconosciute', () => {
  assert.equal(T.delSistema('Ctrl+Esc', 'win32'), true, 'su Windows Ctrl+Esc apre Start');
  assert.equal(T.delSistema('Alt+Tab', 'win32'), true);
  assert.equal(T.delSistema('Ctrl+Space', 'darwin'), true, 'su Mac Cmd+Space è Spotlight');
  assert.equal(T.delSistema('Cmd+Space', 'darwin'), true);
  assert.equal(T.delSistema('Ctrl+Space', 'win32'), false);
  assert.equal(T.delSistema('Ctrl+Esc', 'linux'), false);
  assert.equal(T.delSistema('Ctrl+Shift+1', 'darwin'), false);
});

test("l'Editor non ha un suo parser dei tasti: chiede a SN_TASTI", () => {
  const src = readFileSync(join(ROOT, 'src', 'pages', 'editor', 'editor.js'), 'utf8');
  assert.match(src, /TASTI\.combacia\(/, 'la pressione va confrontata con SN_TASTI.combacia');
  assert.match(src, /TASTI\.pezzoSconosciuto\(/, 'il salvataggio deve rifiutare un nome sconosciuto');
  assert.doesNotMatch(src, /SHORTCUT_MODIFIERS\s*=/, 'secondo elenco dei modificatori tornato nell\'Editor');
  assert.match(src, /TASTI\.delSistema\(/, 'il salvataggio deve rifiutare un tasto del sistema');
  assert.doesNotMatch(src, /function eventKeyCandidates/, 'secondo parser dei tasti tornato nell\'Editor');
});

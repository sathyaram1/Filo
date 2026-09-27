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
  assert.match(src, /TASTI\.tastoRiconosciuto\(/, 'il salvataggio deve rifiutare un tasto sconosciuto');
  assert.match(src, /TASTI\.delSistema\(/, 'il salvataggio deve rifiutare un tasto del sistema');
  assert.doesNotMatch(src, /function eventKeyCandidates/, 'secondo parser dei tasti tornato nell\'Editor');
});

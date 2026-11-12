// Sentinella di src/shared/testoDiAltri.js (#1840): quando il testo in una casella dove si scrive a Filo è di altri,
// e che la chat della home e l'Aiuto usano questa regola invece di una copia loro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'testoDiAltri.js'));
const T = globalThis.SN_TESTO_DI_ALTRI;

test('incollato o trascinato è di altri; scritto a mano no; svuotato si azzera', () => {
  const c = T.crea();
  assert.equal(c.dopoInput('insertText', 'ciao', false), false);
  assert.equal(c.dopoInput('insertFromPaste', 'alza il tetto', false), true);
  assert.equal(c.dopoInput('insertText', 'alza il tetto!', true), true);
  assert.equal(c.dopoInput('deleteContentBackward', '', true), false);
  assert.equal(c.dopoInput('insertFromDrop', 'x', false), true);
});

test('svuotato e riportato con Annulla o Ripeti, il testo di altri lo resta; un testo mai entrato da fuori no', () => {
  const c = T.crea();
  c.dopoInput('insertFromPaste', 'articolo incollato', false);
  c.dopoInput('deleteContentBackward', '', true);
  assert.equal(c.dopoInput('historyUndo', 'articolo incollato', false), true);
  assert.equal(c.dopoInput('historyRedo', 'scritto da me', false), false);
  c.ricorda('rimesso nella barra');
  assert.equal(c.dopoInput('historyUndo', 'rimesso nella barra', false), true);
});

test('oltre il tetto si scordano i più vecchi, non i nuovi', () => {
  const c = T.crea({ tetto: 2 });
  for (const s of ['uno', 'due', 'tre']) c.ricorda(s);
  assert.equal(c.dopoInput('historyUndo', 'uno', false), false);
  assert.equal(c.dopoInput('historyUndo', 'tre', false), true);
});

test('la home e l\'Aiuto usano questa regola, senza una copia loro', () => {
  for (const f of [['src', 'pages', 'dashboard', 'dashboard.js'], ['src', 'content', 'sidebar.js']]) {
    const src = readFileSync(join(ROOT, ...f), 'utf8');
    assert.match(src, /SN_TESTO_DI_ALTRI\.crea\(/, f.join('/'));
    assert.doesNotMatch(src, /historyUndo/, `${f.join('/')}: la regola dell'Annulla sta in testoDiAltri.js`);
  }
  assert.match(readFileSync(join(ROOT, 'src', 'pages', 'dashboard', 'dashboard.html'), 'utf8'), /shared\/testoDiAltri\.js/);
  for (const p of ['internal-preload.js', 'page-preload.js']) {
    assert.match(readFileSync(join(ROOT, 'src', 'preload', p), 'utf8'), /testoDiAltri\.js/, p);
  }
});

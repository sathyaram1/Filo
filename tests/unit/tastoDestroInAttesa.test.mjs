// #2444.1 — il tasto destro dato prima che il menu di Filo ascolti: un gesto dopo lo scarta, la copia porta la scelta
// della pagina e, se la voce è stata ridisegnata, l'elemento sotto il cursore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { tastoDestroInAttesa, RIGIOCO_MS } = require(join(ROOT, 'src', 'preload', 'menu-del-sito.js'));

function finestraFinta(sottoIlCursore = null) {
  const f = new EventTarget();
  f.document = { elementFromPoint: () => sottoIlCursore };
  return f;
}
const voce = (nome) => ({ nome, isConnected: true });
const tastoDestro = (target, { prevenuto = false } = {}) => ({
  target, composedPath: () => [target], clientX: 10, clientY: 20, button: 2, defaultPrevented: prevenuto,
});
// isTrusted lo dà solo il browser: qui si finge com'è sull'evento vero.
function gesto(f, tipo, { vero = true, ripetuto = false } = {}) {
  const e = new Event(tipo);
  Object.defineProperty(e, 'isTrusted', { value: vero });
  Object.defineProperty(e, 'repeat', { value: ripetuto });
  f.dispatchEvent(e);
}

test('senza altri gesti la copia arriva una volta sola, sulla voce cliccata', () => {
  const f = finestraFinta();
  const a = tastoDestroInAttesa(f);
  const v = voce('a');
  a.tieni(tastoDestro(v));
  const copia = a.prendi();
  assert.equal(copia.target, v);
  assert.equal(copia.clientX, 10);
  assert.equal(copia.defaultPrevented, false);
  assert.equal(a.prendi(), null);
});

for (const tipo of ['pointerdown', 'keydown']) {
  test(`un ${tipo} dell'utente dato dopo scarta il tasto destro in attesa`, () => {
    const f = finestraFinta();
    const a = tastoDestroInAttesa(f);
    const t = a.tieni(tastoDestro(voce('a')));
    gesto(f, tipo);
    assert.equal(a.ancora(t), false);
    assert.equal(a.prendi(), null);
  });
}

test('un gesto finto del sito o un tasto tenuto giù da prima non lo scartano', () => {
  const f = finestraFinta();
  const a = tastoDestroInAttesa(f);
  const t = a.tieni(tastoDestro(voce('a')));
  gesto(f, 'pointerdown', { vero: false });
  gesto(f, 'keydown', { ripetuto: true });
  assert.equal(a.ancora(t), true);
  assert.ok(a.prendi());
});

test('un altro tasto destro prende il posto del primo', () => {
  const a = tastoDestroInAttesa(finestraFinta());
  const primo = a.tieni(tastoDestro(voce('a')));
  const b = voce('b');
  const secondo = a.tieni(tastoDestro(b));
  assert.equal(a.ancora(primo), false);
  assert.equal(a.ancora(secondo), true);
  assert.equal(a.prendi().target, b);
});

test('oltre il tempo del rigioco la copia non arriva', (t) => {
  const a = tastoDestroInAttesa(finestraFinta());
  const ora = Date.now();
  t.mock.method(Date, 'now', () => ora);
  a.tieni(tastoDestro(voce('a')));
  Date.now.mock.mockImplementation(() => ora + RIGIOCO_MS + 1);
  assert.equal(a.prendi(), null);
});

test('la copia dice se la pagina ha preso il tasto destro per il suo menu', () => {
  const a = tastoDestroInAttesa(finestraFinta());
  const e = tastoDestro(voce('a'));
  a.tieni(e);
  e.defaultPrevented = true;
  assert.equal(a.prendi().defaultPrevented, true);
});

test('una voce ridisegnata intanto: la copia va a quella sotto il cursore, e senza niente lì non arriva', () => {
  const nuova = voce('nuova');
  const a = tastoDestroInAttesa(finestraFinta(nuova));
  const vecchia = voce('vecchia');
  a.tieni(tastoDestro(vecchia));
  vecchia.isConnected = false;
  const copia = a.prendi();
  assert.equal(copia.target, nuova);
  assert.equal(copia.currentTarget, nuova);
  assert.deepEqual(copia.composedPath(), [nuova]);

  const vuota = tastoDestroInAttesa(finestraFinta(null));
  const sparita = voce('sparita');
  vuota.tieni(tastoDestro(sparita));
  sparita.isConnected = false;
  assert.equal(vuota.prendi(), null);
});

test('smetti toglie l\'ascolto dei gesti e il tasto destro tenuto', () => {
  const f = finestraFinta();
  const a = tastoDestroInAttesa(f);
  a.tieni(tastoDestro(voce('a')));
  a.smetti();
  assert.equal(a.prendi(), null);
});

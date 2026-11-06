// La conferma sul posto tiene la scatola (#256.6): l'aiuto condiviso e chi lo deve usare, invece di rifarlo a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'confermaSulPosto.js'));
const C = globalThis.SN_CONFERMA_SUL_POSTO;

function tasto(w, h, testo) {
  return { style: {}, textContent: testo, getBoundingClientRect: () => ({ width: w, height: h }) };
}

test('armato, il tasto tiene larghezza e altezza di prima; disarmato le rilascia', () => {
  const b = tasto(164.5, 30, 'Elimina definitivamente');
  C.arma(b, 'Confermi?');
  assert.equal(b.textContent, 'Confermi?');
  assert.equal(b.style.minWidth, '164.5px');
  assert.equal(b.style.minHeight, '30px');
  C.disarma(b, 'Elimina definitivamente');
  assert.equal(b.textContent, 'Elimina definitivamente');
  assert.equal(b.style.minWidth, '');
  assert.equal(b.style.minHeight, '');
});

test('le conferme sul posto di editor e Gestione passano dall\'aiuto, che le loro pagine caricano', () => {
  const usi = [
    ['src/pages/editor/editor.js', 'src/pages/editor/editor.html'],
    ['src/pages/manage/manage.js', 'src/pages/manage/manage.html'],
    ['src/pages/manage/manageParola.js', 'src/pages/manage/manage.html'],
  ];
  for (const [js, html] of usi) {
    const src = readFileSync(join(ROOT, js), 'utf8');
    assert.ok(/SN_CONFERMA_SUL_POSTO|CONFERMA\.arma/.test(src), `${js} non usa l'aiuto`);
    // La scritta «Confermi?» si mette solo dall'aiuto: a mano il tasto si stringe sotto il secondo clic.
    assert.ok(!/\.textContent\s*=\s*[`'"]Confermi\?/.test(src), `${js} scrive «Confermi?» a mano`);
    assert.ok(!/style\.minWidth\s*=\s*\S+\s*\+\s*'px'/.test(src), `${js} fissa la scatola a mano`);
    const pagina = readFileSync(join(ROOT, html), 'utf8');
    const aiuto = pagina.indexOf('shared/confermaSulPosto.js');
    assert.ok(aiuto > 0, `${html} non carica l'aiuto`);
    assert.ok(aiuto < pagina.indexOf(js.split('/').pop() + '"'), `${html} carica l'aiuto dopo ${js}`);
  }
});

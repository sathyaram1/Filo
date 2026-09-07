// Sentinella: nessun test si costruisce la cartella temporanea da solo.
//
// Perché conta. Sulla macchina di chi sviluppa Filo l'utente si chiama «agenti
// AI», e da quel nome discendono le due trappole che hanno tenuto rosse per
// settimane undici prove (feedback #563), su una macchina sola e su nessun'altra:
//
//   • lo SPAZIO. Codice che spezza un percorso sugli spazi funziona ovunque
//     tranne che da lui. Chi costruisce la cartella con `mkdtempSync` ottiene un
//     nome senza spazi, quindi la prova gira su un percorso che da lui non
//     esiste;
//   • la forma ABBREVIATA 8.3. Su Windows, con quel nome utente, `os.tmpdir()`
//     risponde `C:\Users\AGENTI~1\...` mentre l'app riporta sempre il nome
//     lungo: ogni confronto fra i due diventa rosso lì e verde altrove.
//
// `cartellaTemporanea` chiude tutte e due. Questa sentinella serve a non
// riaprirle: il prossimo che copia una riga da uno spec vecchio se ne accorge in
// millisecondi invece che fra settimane, per bocca dell'owner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { cartellaTemporanea, percorsoCanonico } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS = join(__dirname, '..');

// Il file che DEFINISCE l'helper è l'unico che può costruirla a mano.
const AMMESSO = join(TESTS, 'helpers', 'percorsi.mjs');

function fileDiTest(dir = TESTS, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileDiTest(p, out);
    else if (nome.endsWith('.mjs')) out.push(p);
  }
  return out;
}

test('nessun test costruisce la cartella temporanea a mano', () => {
  const colpevoli = [];
  for (const p of fileDiTest()) {
    if (p === AMMESSO) continue;
    // La CHIAMATA, non la parola: questo file la nomina per spiegarla.
    if (/mkdtempSync\s*\(/.test(readFileSync(p, 'utf8'))) colpevoli.push(relative(TESTS, p));
  }
  assert.deepEqual(colpevoli, [],
    'questi file si costruiscono la cartella temporanea da soli: usa '
    + '`cartellaTemporanea(prefisso)` da ./helpers/percorsi.mjs, che la fa canonica e con uno spazio nel nome');
});

test('la cartella temporanea nasce con uno spazio nel nome e in forma canonica', () => {
  const dir = cartellaTemporanea('filo-sentinella-');
  try {
    assert.ok(dir.includes(' '), `la cartella dei test deve avere uno spazio nel nome: ${dir}`);
    assert.ok(dir.includes('filo-sentinella-'), `il prefisso di chi chiama deve restare leggibile: ${dir}`);
    assert.equal(dir, percorsoCanonico(dir), 'la cartella deve già essere nella sua forma canonica');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

function fileDiTest(dir = TESTS, out = [], estensioni = /\.mjs$/) {
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.') || nome === 'node_modules') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileDiTest(p, out, estensioni);
    else if (estensioni.test(nome)) out.push(p);
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

// Da un URL di file, `.pathname` su Windows dà `/C:/Users/agenti%20AI/...`: rosso
// solo dove il percorso ha una lettera di disco o uno spazio, cioè dall'owner.
test('nessun test o script ricava un percorso dal pathname di un URL di file', () => {
  const RADICE = join(TESTS, '..');
  const colpevoli = [];
  for (const cartella of ['tests', 'scripts']) {
    for (const p of fileDiTest(join(RADICE, cartella), [], /\.(mjs|cjs|js)$/)) {
      if (/import\.meta\.url\s*\)\s*\.pathname/.test(readFileSync(p, 'utf8'))) {
        colpevoli.push(relative(RADICE, p));
      }
    }
  }
  assert.deepEqual(colpevoli, [],
    'questi file ricavano un percorso con `.pathname` da import.meta.url: usa '
    + '`fileURLToPath(new URL(..., import.meta.url))` da node:url');
});

// Un symlink su Windows vuole l'amministratore o la modalità sviluppatore: senza,
// EPERM, e la prova è rossa solo dall'owner e ferma ogni chiusura locale (#742).
// Si guarda ogni volta che il nome compare, non la forma della chiamata: alias, promisify e accessi per stringa
// sfuggivano. Passano solo il nome importato così com'è e la chiamata diretta con 'junction'.
function creaCollegamentoNegato(sorgente) {
  const testo = String(sorgente).replace(/(^|[^:])\/\/.*$/gm, '$1');
  return (testo.match(/\bsymlink(?:Sync)?\b[^;\n]*/g) || []).some((c) => {
    if (/^symlink(?:Sync)?\s*\(/.test(c)) return !/['"]junction['"]/.test(c);
    return !/^symlink(?:Sync)?\s*[,}]/.test(c);
  });
}

// Riletti a mano: ogni chiamata sta in un caso saltato su win32. Una guardia nel file non basta a esentarlo.
const COLLEGAMENTI_GUARDATI = new Set([join('unit', 'copiaSuFile.test.mjs')]);

test('la sentinella dei collegamenti riconosce ogni forma di node, e non la prosa', () => {
  // Spezzati, o la sentinella qui sotto li troverebbe in questo file.
  const S = 'sym' + 'link';
  assert.equal(creaCollegamentoNegato(`${S}Sync(a, b);`), true);
  assert.equal(creaCollegamentoNegato(`await ${S}(a, b);`), true);
  assert.equal(creaCollegamentoNegato(`await fs.promises.${S}(a, b);`), true);
  assert.equal(creaCollegamentoNegato(`import { ${S}Sync as collega } from 'node:fs';`), true);
  assert.equal(creaCollegamentoNegato(`const { ${S}Sync: collega } = await import('node:fs');`), true);
  assert.equal(creaCollegamentoNegato(`await promisify(fs.${S})(a, b);`), true);
  assert.equal(creaCollegamentoNegato(`fs['${S}Sync'](a, b);`), true);
  assert.equal(creaCollegamentoNegato(
    `const W = process.platform !== 'win32';\nimport { ${S}Sync } from 'node:fs';\n${S}Sync(a, b);`), true);
  assert.equal(creaCollegamentoNegato(`${S}Sync(a, b, 'junction');`), false);
  assert.equal(creaCollegamentoNegato(`import { rmSync, ${S}Sync } from 'node:fs';\n${S}Sync(a, b, 'junction');`), false);
  assert.equal(creaCollegamentoNegato(`// os.tmpdir() è un ${S} (es. /tmp)`), false);
});

test('nessun test crea un collegamento che Windows nega a chi non è amministratore', () => {
  const colpevoli = [];
  for (const p of fileDiTest()) {
    if (p === AMMESSO || COLLEGAMENTI_GUARDATI.has(relative(TESTS, p))) continue;
    if (creaCollegamentoNegato(readFileSync(p, 'utf8'))) colpevoli.push(relative(TESTS, p));
  }
  assert.deepEqual([...new Set(colpevoli)], [],
    'questi file creano un collegamento simbolico, che su Windows senza privilegi dà EPERM: per una cartella usa '
    + '`collegaCartella(verso, collegamento)` da ./helpers/percorsi.mjs; per un file salta il caso su win32 e '
    + 'aggiungi il file a COLLEGAMENTI_GUARDATI');
});

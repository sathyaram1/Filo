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
import { dirname, join, relative, posix, win32 } from 'node:path';
import { cartellaTemporanea, fuoriDa, percorsoCanonico } from '../helpers/percorsi.mjs';

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
// Il nome si compone: scritto intero, questo file troverebbe sé stesso.
const NOME = `${'sym'}${'link'}(?:Sync)?`;
function creaCollegamentoNegato(sorgente) {
  const testo = String(sorgente).replace(/(^|[^:])\/\/.*$/gm, '$1');
  return (testo.match(new RegExp(`\\b${NOME}\\b[^;\\n]*`, 'g')) || []).some((c) => {
    if (new RegExp(`^${NOME}\\s*\\(`).test(c)) return !/['"]junction['"]/.test(c);
    return !new RegExp(`^${NOME}\\s*[,}]`).test(c);
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

// Sul cancello Windows il repo sta su D: e la temporanea su C:. Fra due dischi `relative` dà un percorso assoluto,
// e «comincia con ..» risponde «dentro» per un file che sta fuori (#931).
const FUORI_A_MANO = /\brelative\s*\([^;\n]*\)\s*\.startsWith\(\s*[`'"]\.\./;
// Il node che esegue la prova tiene aperto il suo file: su Windows nessun nome di quel file si cancella (#931).
const COLLEGAMENTO_AL_NODE = new RegExp(`\\b${'link'}(?:Sync)?\\s*\\(\\s*process\\.execPath`);

test('le due trappole del disco del cancello si riconoscono', () => {
  assert.ok(FUORI_A_MANO.test("assert.ok(relative(repo, f).startsWith('..'));"));
  assert.ok(!FUORI_A_MANO.test('assert.ok(fuoriDa(repo, f));'));
  assert.ok(COLLEGAMENTO_AL_NODE.test(`${'link'}Sync(process.execPath, join(bin, 'gh.exe'));`));
  assert.ok(!COLLEGAMENTO_AL_NODE.test("copyFileSync(process.execPath, join(bin, 'gh.exe'));"));
});

test('nessun test presume il repo e la temporanea sullo stesso disco, né collega il node che gira', () => {
  const colpevoli = [];
  for (const p of fileDiTest()) {
    if (p === AMMESSO || p === fileURLToPath(import.meta.url)) continue;
    const testo = readFileSync(p, 'utf8');
    if (FUORI_A_MANO.test(testo)) colpevoli.push(`${relative(TESTS, p)}: usa fuoriDa(cartella, percorso) da ./helpers/percorsi.mjs`);
    if (COLLEGAMENTO_AL_NODE.test(testo)) colpevoli.push(`${relative(TESTS, p)}: copia l'eseguibile invece di collegarlo`);
  }
  assert.deepEqual(colpevoli, []);
});

test('fuoriDa: un file su un altro disco sta fuori, uno dentro sta dentro, su Windows come altrove', () => {
  assert.equal(fuoriDa('D:\\a\\Filo', 'C:\\Users\\r\\Temp\\01-diff.txt', win32), true);
  assert.equal(fuoriDa('D:\\a\\Filo', 'D:\\a\\Altro\\x.txt', win32), true);
  assert.equal(fuoriDa('D:\\a\\Filo', 'D:\\a\\Filo\\..cache\\x.txt', win32), false);
  assert.equal(fuoriDa('D:\\a\\Filo', 'D:\\a\\Filo', win32), false);
  assert.equal(fuoriDa('/repo', '/tmp/01-diff.txt', posix), true);
  assert.equal(fuoriDa('/repo', '/repo/..cache/x', posix), false);
  assert.equal(fuoriDa('/repo', '/', posix), true);
});

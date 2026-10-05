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
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, posix, win32 } from 'node:path';
import {
  cartellaTemporanea, collegaCartella, collegaFile, COLLEGAMENTO_NEGATO, fuoriDa, percorsoCanonico, togliCartella,
} from '../helpers/percorsi.mjs';

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
    // La CHIAMATA, non la parola: questo file la nomina per spiegarla. Anche la forma asincrona, che salterebbe la
    // pulizia all'uscita (#717); il nome si compone, o la regola troverebbe sé stessa.
    if (new RegExp(`\\b${'mk'}dtemp(?:Sync)?\\s*\\(`).test(readFileSync(p, 'utf8'))) colpevoli.push(relative(TESTS, p));
  }
  assert.deepEqual(colpevoli, [],
    'questi file si costruiscono la cartella temporanea da soli: usa '
    + '`cartellaTemporanea(prefisso)` da ./helpers/percorsi.mjs, che la fa canonica, con uno spazio nel nome, '
    + 'e la toglie quando il processo finisce');
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

// Un symlink su Windows vuole l'amministratore o la modalità sviluppatore: senza, EPERM, e la prova (o lo
// script di chiusura) è rossa solo dall'owner e ferma ogni chiusura locale (#742).
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

test('nessun test o script crea un collegamento che Windows nega a chi non è amministratore', () => {
  const RADICE = join(TESTS, '..');
  const colpevoli = [];
  for (const cartella of ['tests', 'scripts']) {
    for (const p of fileDiTest(join(RADICE, cartella), [], /\.(mjs|cjs|js)$/)) {
      if (p === AMMESSO) continue;
      if (creaCollegamentoNegato(readFileSync(p, 'utf8'))) colpevoli.push(relative(RADICE, p));
    }
  }
  assert.deepEqual(colpevoli, [],
    'questi file creano un collegamento simbolico, che su Windows senza privilegi dà EPERM: da ./helpers/percorsi.mjs '
    + 'usa `collegaCartella(verso, collegamento)` per una cartella e `collegaFile` per un file (col motivo che '
    + 'restituisce a `t.skip`); uno script passa \'junction\' a mano');
});

// Il ripiego si prova sul sistema finto: chi lavora qui non ha un Windows senza privilegi su cui vederlo.
test('su Windows la cartella si collega con una junction, altrove con un collegamento simbolico', () => {
  const tipi = {};
  for (const sistema of ['win32', 'darwin', 'linux']) {
    collegaCartella('verso', 'qui', { sistema, collega: (_v, _c, tipo) => { tipi[sistema] = tipo; } });
  }
  assert.deepEqual(tipi, { win32: 'junction', darwin: 'dir', linux: 'dir' });
});

test('un file che Windows non lascia collegare salta il caso col motivo, e solo lì', () => {
  const negato = () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); };
  assert.equal(collegaFile('verso', 'qui', { sistema: 'win32', collega: negato }), COLLEGAMENTO_NEGATO);
  assert.match(COLLEGAMENTO_NEGATO, /Windows.*EPERM/);
  for (const sistema of ['darwin', 'linux']) {
    assert.throws(() => collegaFile('verso', 'qui', { sistema, collega: negato }), { code: 'EPERM' },
      `su ${sistema} un EPERM è un guasto vero: saltare il caso lo nasconderebbe`);
  }
  const altro = () => { throw Object.assign(new Error('no such file'), { code: 'ENOENT' }); };
  assert.throws(() => collegaFile('verso', 'qui', { sistema: 'win32', collega: altro }), { code: 'ENOENT' });
});

test('dove il sistema lo permette, i due collegamenti portano davvero al loro contenuto', () => {
  const dir = cartellaTemporanea('filo-collegamenti-');
  try {
    const cartella = join(dir, 'vera');
    mkdirSync(cartella);
    writeFileSync(join(cartella, 'dentro.txt'), 'cartella', 'utf8');
    collegaCartella(cartella, join(dir, 'alla cartella'));
    assert.equal(readFileSync(join(dir, 'alla cartella', 'dentro.txt'), 'utf8'), 'cartella');

    const file = join(dir, 'vero.txt');
    writeFileSync(file, 'file', 'utf8');
    const negato = collegaFile(file, join(dir, 'al file.txt'));
    if (negato) return;
    assert.ok(lstatSync(join(dir, 'al file.txt')).isSymbolicLink());
    assert.equal(readFileSync(join(dir, 'al file.txt'), 'utf8'), 'file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// ── La pulizia non fa rosso un test giusto (#750) ──────────────────────────

const RITENTA_A_MANO = /\brm(?:Sync)?\s*\([^;]*?maxRetries/;
const occupata = (code) => () => { throw Object.assign(new Error(`${code}: resource busy or locked`), { code }); };

test('nessun test ritenta la pulizia da sé: dopo i tentativi rmSync lancia ancora, e il test giusto diventa rosso', () => {
  assert.ok(RITENTA_A_MANO.test('rmSync(casa, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });'));
  assert.ok(!RITENTA_A_MANO.test('rmSync(casa, { recursive: true, force: true });'));
  const colpevoli = [];
  for (const p of fileDiTest()) {
    if (p === AMMESSO || p === fileURLToPath(import.meta.url)) continue;
    if (RITENTA_A_MANO.test(readFileSync(p, 'utf8'))) colpevoli.push(relative(TESTS, p));
  }
  assert.deepEqual(colpevoli, [],
    'questi file ritentano la pulizia a mano: usa `togliCartella(cartella)` da ./helpers/percorsi.mjs, '
    + 'che oltre a ritentare non fa rosso il test quando Windows tiene ancora la cartella');
});

test('togliCartella toglie la cartella con quello che contiene', () => {
  const dir = cartellaTemporanea('filo-togli-');
  mkdirSync(join(dir, 'dentro'));
  writeFileSync(join(dir, 'dentro', 'f.txt'), 'x');
  assert.equal(togliCartella(dir), true);
  assert.equal(existsSync(dir), false);
  assert.equal(togliCartella(dir), true, 'una cartella che non c\'è più non è un errore');
});

test('togliCartella: una cartella che Windows tiene ancora non fa rosso il test, un altro guasto sì', () => {
  for (const code of ['EBUSY', 'EPERM', 'ENOTEMPTY']) {
    assert.equal(togliCartella(join('non', 'esiste', code), { rm: occupata(code) }), false, code);
  }
  assert.throws(() => togliCartella('x', { rm: occupata('EINVAL') }), /EINVAL/);
});

test('togliCartella: la cartella rimasta occupata sparisce quando il test esce', () => {
  const dir = cartellaTemporanea('filo-togli-uscita-');
  writeFileSync(join(dir, 'tenuto.txt'), 'x');
  const helper = pathToFileURL(join(TESTS, 'helpers', 'percorsi.mjs')).href;
  const codice = `
    import { rmSync, existsSync } from 'node:fs';
    import { togliCartella } from ${JSON.stringify(helper)};
    let prima = true;
    const rm = (d, o) => { if (prima) { prima = false; throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); } rmSync(d, o); };
    const dir = ${JSON.stringify(dir)};
    console.log(JSON.stringify({ tolta: togliCartella(dir, { rm }), cePrimaDellUscita: existsSync(dir) }));
  `;
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', codice], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { tolta: false, cePrimaDellUscita: true });
    assert.equal(existsSync(dir), false, 'all\'uscita del processo la cartella rimasta va ritentata');
  } finally {
    togliCartella(dir);
  }
});

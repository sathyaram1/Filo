// #746: una prova del giro rossa non diventa verde senza correggere il codice, nemmeno passando per un file di
// supporto o togliendo nella pulizia la riga del caso da correggere. Playwright qui è finto, ma scrive l'esito per caso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import {
  supportoDelGiro, aiutiFuoriDalGiro, proveCheDipendono, casiDalReport, casiSpenti, testoCasiSpenti, controllaCasiDellaPulizia,
  controllaProveTolte, controllaPulizia, puliziaDelPass, PREFISSO_RIPRISTINO,
} from '../../scripts/lib/prove-tolte.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const preparaFinto = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });

// Un caso è `test('titolo', …)`; dentro, `verifica('k')` legge in un aiuto importato la riga `k: 'stato-k.txt'`, e il
// caso è rosso se quel file dice «rotto». Togliere la riga dall'aiuto, o la verifica dal caso, spegne il controllo.
const FINTO = [
  "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
  "import { dirname, resolve } from 'node:path';",
  "const f = process.argv.find((a) => /\\.spec\\.mjs$/.test(a));",
  'const visti = new Set();',
  'const aiuti = (file) => [...readFileSync(file, "utf8").matchAll(/from \'(\\.\\.?\\/[^\']+)\'/g)]',
  '  .map((m) => resolve(dirname(file), m[1])).filter((p) => existsSync(p) && !visti.has(p) && visti.add(p))',
  '  .map((p) => `${readFileSync(p, "utf8")}\\n${aiuti(p)}`).join("\\n");',
  'const testo = readFileSync(f, "utf8");',
  'const tutti = aiuti(f);',
  'const rotto = (s) => existsSync(s) && readFileSync(s, "utf8").includes("rotto");',
  'const specs = testo.split(/(?=test\\(\')/).filter((b) => b.startsWith("test(\'")).map((b) => ({',
  '  title: /^test\\(\'([^\']+)\'/.exec(b)[1],',
  '  ok: ![...b.matchAll(/verifica\\(\'(\\w+)\'\\)/g)].map((m) => new RegExp(`^\\\\s*${m[1]}: \'([^\']+)\'`, "m").exec(tutti)?.[1])',
  '    .filter(Boolean).some(rotto),',
  '}));',
  'if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {',
  '  writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({ suites: [{ title: f, specs, suites: [] }], errors: [] }));',
  '}',
  'const rossa = specs.some((s) => !s.ok);',
  'console.log(`${rossa ? "rossa" : "verde"}: ${f}`);',
  'process.exit(rossa ? 1 : 0);',
  '',
].join('\n');

const CARTELLA = 'tests/verifica/746';
const AIUTO = `${CARTELLA}/helpers/banco.mjs`;
const caso = (titolo, ...k) => `test('${titolo}', () => {\n${k.map((x) => `  verifica('${x}');\n`).join('')}});\n`;
const banco = (...k) => `export const banco = {\n${k.map((x) => `  ${x}: 'stato-${x}.txt',\n`).join('')}};\n`;
const prova = (...casi) => `import { banco } from './helpers/banco.mjs';\n${casi.join('')}`;

function giro(files, { ramo = 'worker/746' } = {}) {
  const dir = cartellaTemporanea('prove-casi-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', ramo);
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', 'stato/\n.claude/\nbin/\ntests/verifica/_tolte-*/\n');
  scrivi('bin/npx.mjs', FINTO);
  scrivi('bin/npx', `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/npx.mjs" "$@"\n`);
  scrivi('bin/npx.cmd', `@"${process.execPath}" "%~dp0npx.mjs" %*\r\n`);
  chmodSync(resolve(dir, 'bin', 'npx'), 0o755);
  g('add', '-A'); g('commit', '-qm', 'avvio della verifica');
  const avvio = g('rev-parse', 'HEAD');
  for (const [f, t] of Object.entries(files)) scrivi(f, t);
  g('add', '-A'); g('commit', '-qm', 'critica');
  const critica = g('rev-parse', 'HEAD');
  const visti = [];
  const lancia = (cmd, args, opz) => {
    visti.push({ file: args.find((a) => a.endsWith('.spec.mjs')), json: !!opz.env?.PLAYWRIGHT_JSON_OUTPUT_FILE });
    return spawnSync(process.execPath, [resolve(dir, 'bin', 'npx.mjs'), ...args], { cwd: opz.cwd, env: opz.env || process.env, encoding: 'utf8' });
  };
  const commit = (m) => { g('add', '-A'); g('commit', '-qm', m); return g('rev-parse', 'HEAD'); };
  const togli = (f, ...righe) => scrivi(f, readFileSync(resolve(dir, f), 'utf8').split('\n').filter((l) => !righe.some((r) => l.includes(r))).join('\n'));
  return { dir, g, scrivi, avvio, critica, visti, lancia, commit, togli };
}

const nomi = (visti) => visti.map((v) => v.file.split('/').pop());

// ─── Le parti pure ───

test('un file di supporto della cartella del giro non è una prova, e una prova non è supporto', () => {
  assert.deepEqual(supportoDelGiro([
    'tests/verifica/746/helpers/banco.mjs', 'tests/verifica/746/pagina.html', 'tests/verifica/746/giro1-r1-a.spec.mjs',
    'tests/fixtures/electron.mjs', `tests/verifica/${PREFISSO_RIPRISTINO}746-1/helpers/banco.mjs`, 'tests/verifica/x.mjs',
    'tests\\verifica\\746\\dati.json',
  ]), ['tests/verifica/746/helpers/banco.mjs', 'tests/verifica/746/pagina.html', 'tests/verifica/746/dati.json']);
});

test('dipende da un file di supporto la prova che lo nomina, anche passando per un altro aiuto, nella sua cartella', () => {
  const testi = [
    { path: 'tests/verifica/746/giro1-r1-a.spec.mjs', testo: "import { a } from './helpers/a.mjs';" },
    { path: 'tests/verifica/746/helpers/a.mjs', testo: "import dati from './dati.json' with { type: 'json' };" },
    { path: 'tests/verifica/746/giro1-r2-b.spec.mjs', testo: "import { b } from './helpers/mio-dati.json';" },
    { path: 'tests/verifica/746/giro1-r3-c.spec.mjs', testo: "page.goto(fileUrl(join(__dirname, 'dati.json')));" },
    { path: 'tests/verifica/800/giro1-r1-x.spec.mjs', testo: "import dati from './dati.json';" },
  ];
  const r = proveCheDipendono(testi, ['tests/verifica/746/helpers/dati.json']);
  assert.deepEqual(r.prove.sort(), ['tests/verifica/746/giro1-r1-a.spec.mjs', 'tests/verifica/746/giro1-r3-c.spec.mjs']);
  assert.deepEqual(r.via['tests/verifica/746/giro1-r1-a.spec.mjs'], ['tests/verifica/746/helpers/dati.json']);
  assert.deepEqual(proveCheDipendono(testi, ['tests/verifica/746/giro1-r1-a.spec.mjs']), { prove: [], via: {} }, 'una prova non è supporto');
  assert.deepEqual(proveCheDipendono(null, ['tests/verifica/746/helpers/dati.json']), { prove: [], via: {} });
});

test('dal rapporto di Playwright l\'esito di ogni caso, coi describe nel titolo e senza il file', () => {
  const casi = casiDalReport({
    suites: [{
      title: 'verifica/_tolte-746-1/a.spec.mjs',
      specs: [{ title: 'fuori', ok: true }],
      suites: [{ title: 'gruppo', specs: [{ title: 'rosso', ok: false }, { title: 'verde', ok: true }], suites: [] }],
    }],
  });
  assert.deepEqual(casi, { fuori: true, 'gruppo › rosso': false, 'gruppo › verde': true });
  assert.deepEqual(casiDalReport({ suites: [], errors: [{ message: 'non carica' }] }), {}, 'un file che non carica non ha casi');
  for (const storto of [null, {}, { suites: 'x' }, 'testo']) assert.equal(casiDalReport(storto), null);
});

test('sullo stesso codice, la pulizia spegne un caso rosso o toglie l\'ultimo rosso', () => {
  const rossa = (casi) => ({ rossa: Object.values(casi).includes(false), casi });
  assert.deepEqual(casiSpenti(rossa({ b: false, c: false }), rossa({ c: false })), { spenti: [], vuota: false }, 'tolto solo il caso b');
  assert.deepEqual(casiSpenti(rossa({ b: false, c: false }), rossa({ c: true })), { spenti: ['c'], vuota: true });
  assert.deepEqual(casiSpenti(rossa({ b: false, c: false, d: false }), rossa({ c: true, d: false })), { spenti: ['c'], vuota: false });
  assert.deepEqual(casiSpenti(rossa({ b: false, c: false }), rossa({})), { spenti: [], vuota: true }, 'il file non carica più');
  assert.deepEqual(casiSpenti(rossa({ g: true }), rossa({})), { spenti: [], vuota: false }, 'era tutta verde: niente da tenere rosso');
  assert.deepEqual(casiSpenti({ rossa: true, casi: null }, { rossa: false, casi: null }), { spenti: [], vuota: true }, 'senza i casi decide il file');
  assert.deepEqual(casiSpenti({ rossa: true, casi: null }, { rossa: true, casi: null }), { spenti: [], vuota: false });
  assert.equal(testoCasiSpenti([{ f: 'x', spenti: [], vuota: false }]), '');
  const t = testoCasiSpenti([{ f: `${CARTELLA}/giro1-r3-c.spec.mjs`, spenti: ['caso c'], vuota: false }], { [`${CARTELLA}/giro1-r3-c.spec.mjs`]: [AIUTO] }, 'abcdef1234567890');
  assert.match(t, /giro1-r3-c\.spec\.mjs \(usa helpers\/banco\.mjs\): «caso c» era rosso ed è verde/);
  assert.match(t, /git checkout abcdef123456 -- <file>/);
});

// ─── Prima porta: chi corregge cambia un file di supporto della cartella del giro ───

test('la consegna rilancia le prove che usano un file di supporto cambiato, anche per un altro aiuto, e la respinge se sono rosse', () => {
  const t = giro({
    [`${CARTELLA}/giro1-r1-a.spec.mjs`]: prova(caso('caso a', 'a')),
    [`${CARTELLA}/giro1-r2-b.spec.mjs`]: "import { dati } from './helpers/altro.mjs';\n" + caso('caso b', 'b'),
    [AIUTO]: "export { banco } from './dati.mjs';\n",
    [`${CARTELLA}/helpers/dati.mjs`]: banco('a'),
    [`${CARTELLA}/helpers/altro.mjs`]: banco('b'),
    'stato-a.txt': 'rotto\n', 'stato-b.txt': 'rotto\n',
  });
  try {
    t.scrivi(`${CARTELLA}/helpers/dati.mjs`, banco());
    t.commit('correzione che indebolisce l\'aiuto invece del codice');
    const e = controllaProveTolte({ shaPrima: t.critica, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true, 'com\'era, sul codice di adesso, la prova di a è ancora rossa');
    assert.match(e.testo, /giro1-r1-a\.spec\.mjs \(usa helpers\/dati\.mjs\)/);
    assert.match(e.testo, /file di supporto/);
    assert.deepEqual(nomi(t.visti), ['giro1-r1-a.spec.mjs'], 'la prova che non lo usa non si rilancia');
    t.scrivi('stato-a.txt', 'corretto\n');
    t.commit('correzione vera');
    assert.deepEqual(controllaProveTolte({ shaPrima: t.critica, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} }), { ferma: false, testo: '' });
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('un aiuto importato senza estensione è una dipendenza; il nome di una prova scritto altrove no', () => {
  const testi = [
    { path: 'tests/verifica/746/giro1-r1-a.spec.mjs', testo: "import { a } from './helpers/a';" },
    { path: 'tests/verifica/746/giro1-r2-b.spec.mjs', testo: "import { b } from './helpers/ab';\nconst x = 'a';" },
    { path: 'tests/verifica/746/giro1-r3-c.spec.mjs', testo: "scrivi('giro1-r1-a.spec.mjs', '');" },
  ];
  assert.deepEqual(proveCheDipendono(testi, ['tests/verifica/746/helpers/a.mjs']).prove, ['tests/verifica/746/giro1-r1-a.spec.mjs']);
});

test('gli aiuti comuni dei test fuori dal giro sono supporto, le fixture comprese; i test e le prove no', () => {
  assert.deepEqual(aiutiFuoriDalGiro([
    'tests/fixtures/electron.mjs', 'tests/helpers/percorsi.mjs', 'tests/unit/x.test.mjs', 'tests/tabs.spec.mjs',
    'tests/verifica/746/helpers/banco.mjs', 'src/main/main.js', 'tests\\helpers\\dati.json',
  ]), ['tests/fixtures/electron.mjs', 'tests/helpers/percorsi.mjs', 'tests/helpers/dati.json']);
  const testi = [
    { path: 'tests/verifica/746/giro1-r1-a.spec.mjs', testo: "import { test } from '../../fixtures/electron.mjs';" },
    { path: 'tests/fixtures/electron.mjs', testo: "import { cartellaTemporanea } from '../helpers/percorsi.mjs';" },
    { path: 'tests/verifica/746/giro1-r2-b.spec.mjs', testo: "import { test } from '@playwright/test';" },
  ];
  const r = proveCheDipendono(testi, ['tests/helpers/percorsi.mjs']);
  assert.deepEqual(r, { prove: ['tests/verifica/746/giro1-r1-a.spec.mjs'], via: { 'tests/verifica/746/giro1-r1-a.spec.mjs': ['tests/helpers/percorsi.mjs'] } });
});

test('un aiuto comune fuori dal giro indebolito da chi corregge: la prova si rilancia con l\'aiuto com\'era, in una copia a parte', () => {
  const COMUNE = 'tests/helpers/banco-comune.mjs';
  const t = giro({
    [`${CARTELLA}/giro1-r1-a.spec.mjs`]: `import { banco } from '../../helpers/banco-comune.mjs';\n${caso('caso a', 'a')}`,
    [`${CARTELLA}/giro1-r2-b.spec.mjs`]: prova(caso('caso b', 'b')),
    [AIUTO]: banco('b'),
    [COMUNE]: banco('a'),
    'stato-a.txt': 'rotto\n', 'stato-b.txt': 'corretto\n',
  });
  try {
    t.scrivi(COMUNE, banco());
    t.commit('correzione che indebolisce l\'aiuto comune invece del codice');
    const e = controllaProveTolte({ shaPrima: t.critica, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true, 'con l\'aiuto com\'era la prova di a è ancora rossa');
    assert.match(e.testo, /giro1-r1-a\.spec\.mjs \(usa tests\/helpers\/banco-comune\.mjs\)/);
    assert.deepEqual(nomi(t.visti), ['giro1-r1-a.spec.mjs'], 'la prova che non usa l\'aiuto comune non si rilancia');
    assert.equal(readFileSync(resolve(t.dir, COMUNE), 'utf8'), banco(), 'il ramo resta com\'è: l\'aiuto vecchio vive solo nella copia');
    assert.equal(t.g('worktree', 'list').split('\n').length, 1, 'la copia a parte se ne va');
    assert.equal(t.g('status', '--porcelain'), '');
    t.scrivi('stato-a.txt', 'corretto\n');
    t.commit('correzione vera');
    assert.deepEqual(controllaProveTolte({ shaPrima: t.critica, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} }), { ferma: false, testo: '' });
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

// ─── Seconda porta: la pulizia toglie righe da un file di supporto condiviso ───

const DUE_RILIEVI = () => ({
  [`${CARTELLA}/giro1-r1-a.spec.mjs`]: prova(caso('caso a', 'a')),
  [`${CARTELLA}/giro1-r2-b.spec.mjs`]: prova(caso('caso b', 'b')),
  [AIUTO]: banco('a', 'b'),
  'stato-a.txt': 'rotto\n', 'stato-b.txt': 'rotto\n',
});

test('un file di supporto non conta come prova tolta nella pulizia', () => {
  const t = giro(DUE_RILIEVI());
  try {
    t.togli(AIUTO, "b: 'stato-b.txt'");
    t.commit('pulizia che tocca solo l\'aiuto');
    const solo = controllaPulizia({ shaCritica: t.critica, root: t.dir });
    assert.equal(solo.ok, false);
    assert.match(solo.motivo, /nessuna prova del giro \(un file di supporto non è una prova\)/);
    assert.equal(puliziaDelPass(t.critica, [{ sha: t.g('rev-parse', 'HEAD'), by: 'release:verifier' }], t.dir), '', 'nemmeno dopo un pass');
    t.g('rm', '-q', `${CARTELLA}/giro1-r2-b.spec.mjs`);
    t.commit('e la prova messa da parte');
    const c = controllaPulizia({ shaCritica: t.critica, root: t.dir });
    assert.equal(c.ok, true, c.motivo);
    assert.deepEqual(c.files, [`${CARTELLA}/giro1-r2-b.spec.mjs`]);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('la pulizia che toglie da un aiuto condiviso la riga di un rilievo da correggere non si registra', () => {
  const t = giro(DUE_RILIEVI());
  try {
    t.g('rm', '-q', `${CARTELLA}/giro1-r2-b.spec.mjs`);
    t.togli(AIUTO, "a: 'stato-a.txt'");
    const sha = t.commit('pulizia che toglie anche la riga di a');
    const e = controllaCasiDellaPulizia({ shaCritica: t.critica, sha, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-r1-a\.spec\.mjs \(usa helpers\/banco\.mjs\): «caso a» era rosso ed è verde/);
    assert.ok(t.visti.every((v) => v.json), 'l\'esito si chiede per caso');
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
  const giusta = giro(DUE_RILIEVI());
  try {
    giusta.g('rm', '-q', `${CARTELLA}/giro1-r2-b.spec.mjs`);
    giusta.togli(AIUTO, "b: 'stato-b.txt'");
    const sha = giusta.commit('pulizia: la prova di b e la sua riga nell\'aiuto');
    assert.deepEqual(controllaCasiDellaPulizia({ shaCritica: giusta.critica, sha, root: giusta.dir, lancia: giusta.lancia, prepara: preparaFinto, log: () => {} }),
      { ferma: false, testo: '' });
    assert.deepEqual(nomi(giusta.visti), ['giro1-r1-a.spec.mjs'], 'rossa dopo la pulizia: com\'era non serve rilanciarla');
  } finally {
    rmSync(giusta.dir, { recursive: true, force: true });
  }
});

// ─── Terza porta: in una prova che copre più rilievi la pulizia toglie anche la riga di uno da correggere ───

test('in una prova di due rilievi la pulizia che toglie anche la verifica di quello da correggere non si registra', () => {
  const file = `${CARTELLA}/giro1-r2-r3-bc.spec.mjs`;
  const t = giro({ [file]: prova(caso('caso b', 'b'), caso('caso c', 'c')), [AIUTO]: banco('b', 'c'), 'stato-b.txt': 'rotto\n', 'stato-c.txt': 'rotto\n' });
  try {
    t.scrivi(file, prova(`test('caso c', () => {\n});\n`));
    const sha = t.commit('pulizia: tolto il caso b e la verifica di c');
    const e = controllaCasiDellaPulizia({ shaCritica: t.critica, sha, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-r2-r3-bc\.spec\.mjs: «caso c» era rosso ed è verde/);
    t.scrivi(file, prova());
    const vuota = t.commit('pulizia: tolti tutti e due i casi');
    assert.match(controllaCasiDellaPulizia({ shaCritica: t.critica, sha: vuota, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} }).testo,
      /giro1-r2-r3-bc\.spec\.mjs: non ha più un caso rosso/);
    t.scrivi(file, prova(caso('caso c', 'c')));
    const giusta = t.commit('pulizia: tolto solo il caso b');
    assert.equal(controllaCasiDellaPulizia({ shaCritica: t.critica, sha: giusta, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} }).ferma, false);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('in una prova di tre rilievi un caso spento si vede anche se un altro resta rosso', () => {
  const file = `${CARTELLA}/giro1-r2-r3-r4-bcd.spec.mjs`;
  const t = giro({
    [file]: prova(caso('caso b', 'b'), caso('caso c', 'c'), caso('caso d', 'd')), [AIUTO]: banco('b', 'c', 'd'),
    'stato-b.txt': 'rotto\n', 'stato-c.txt': 'rotto\n', 'stato-d.txt': 'rotto\n',
  });
  try {
    t.scrivi(file, prova(`test('caso c', () => {\n});\n`, caso('caso d', 'd')));
    const sha = t.commit('pulizia: tolto b e la verifica di c, d resta rosso');
    const e = controllaCasiDellaPulizia({ shaCritica: t.critica, sha, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true, 'il file è ancora rosso per d, ma c si è spento');
    assert.match(e.testo, /«caso c» era rosso ed è verde/);
    assert.doesNotMatch(e.testo, /«caso d»/);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('dopo una pulizia che toglie righe da un aiuto, la consegna rilancia le prove che lo usano com\'erano dopo di lei', () => {
  const t = giro(DUE_RILIEVI());
  try {
    t.g('rm', '-q', `${CARTELLA}/giro1-r2-b.spec.mjs`);
    t.togli(AIUTO, "b: 'stato-b.txt'");
    const pulizia = t.commit('pulizia');
    t.scrivi('altro.js', 'una correzione che non tocca a\n');
    t.commit('correzione a metà');
    const opz = { shaPrima: pulizia, root: t.dir, lancia: t.lancia, prepara: preparaFinto, conPulizia: true, shaCritica: t.critica, log: () => {} };
    const e = controllaProveTolte(opz);
    assert.equal(e.ferma, true, 'la prova di a non è stata toccata da chi corregge, ma la pulizia le ha cambiato l\'aiuto');
    assert.match(e.testo, /giro1-r1-a\.spec\.mjs \(usa helpers\/banco\.mjs\)/);
    t.scrivi('stato-a.txt', 'corretto\n');
    t.commit('correzione di a');
    assert.deepEqual(controllaProveTolte(opz), { ferma: false, testo: '' });
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

// ─── I due comandi veri della pulizia, locale e routine, passano da questo controllo ───

test('le due pulizie, locale e routine, rilanciano le prove toccate prima di registrare', () => {
  const locale = readFileSync(resolve(ROOT, 'scripts', 'verify-local.mjs'), 'utf8');
  const routine = readFileSync(resolve(ROOT, 'scripts', 'dispatch.mjs'), 'utf8');
  assert.match(locale, /controllaCasiDellaPulizia\(\{ shaCritica: aperto\.pending\.sha, sha: controllo\.sha, root: ROOT/);
  assert.match(routine, /controllaCasiDellaPulizia\(\{ shaCritica: st\.verifierSha, sha: r\.state\.puliziaSha, root: ROOT/);
});

function esegui(script, argv, env, cwd) {
  return new Promise((r) => {
    execFile(process.execPath, [resolve(ROOT, 'scripts', script), ...argv], { cwd, env: { ...process.env, ...env } },
      (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, testo: `${so || ''}\n${se || ''}` }));
  });
}

test('dispatch --record-pulizia respinge la pulizia che spegne il caso da correggere, e registra quella giusta', async () => {
  const file = `${CARTELLA}/giro1-r1-r2-ab.spec.mjs`;
  const t = giro({ [file]: prova(caso('caso a', 'a'), caso('caso b', 'b')), [AIUTO]: banco('a', 'b'), 'stato-a.txt': 'rotto\n', 'stato-b.txt': 'rotto\n' });
  const stato = resolve(t.dir, 'stato', 'fid-746.json');
  mkdirSync(dirname(stato), { recursive: true });
  writeFileSync(stato, JSON.stringify({
    id: 'fid-746', branch: 'worker/746', verifierVerdict: 'fix-pending', verifierSha: t.critica,
    messiDaParteGiro: { sha: t.critica, n: 1, numeri: [2] }, checkpoints: [{ sha: t.critica, by: 'verifier:fix' }],
  }));
  const env = {
    FILO_REPO_ROOT: t.dir, FILO_DISPATCH_STATE_DIR: resolve(t.dir, 'stato'), FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_API: 'http://127.0.0.1:9',
    FILO_ROUTINE_TICKET: 'biglietto-di-prova', FILO_ROUTINE_ROLE: 'verifier', FILO_NO_BEAT: '1', DISPLAY: process.env.DISPLAY || ':0',
    PATH: `${resolve(t.dir, 'bin')}${delimiter}${process.env.PATH}`,
  };
  try {
    t.scrivi(file, prova(`test('caso a', () => {\n});\n`));
    t.commit('pulizia: tolto b e la verifica di a');
    const no = await esegui('dispatch.mjs', ['--record-pulizia', 'fid-746'], env, t.dir);
    assert.notEqual(no.code, 0, no.testo);
    assert.match(no.testo, /«caso a» era rosso ed è verde/);
    assert.equal(JSON.parse(readFileSync(stato, 'utf8')).puliziaSha || '', '', 'la pulizia non è registrata');
    t.scrivi(file, prova(caso('caso a', 'a')));
    const giusta = t.commit('pulizia: tolto solo il caso b');
    const si = await esegui('dispatch.mjs', ['--record-pulizia', 'fid-746'], env, t.dir);
    assert.equal(si.code, 0, si.testo);
    assert.equal(JSON.parse(readFileSync(stato, 'utf8')).puliziaSha, giusta);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test('verify-local pulizia respinge allo stesso modo la pulizia che spegne il caso da correggere', async () => {
  const { withRequest, withCritique } = await import('../../scripts/verify-local.mjs');
  const ramo = 'claude/prova-giro';
  const cartella = 'tests/verifica/locale-prova-giro';
  const file = `${cartella}/giro1-r2-r3-bc.spec.mjs`;
  const t = giro({
    [file]: `import { banco } from './helpers/banco.mjs';\n${caso('caso b', 'b')}${caso('caso c', 'c')}`,
    [`${cartella}/helpers/banco.mjs`]: banco('b', 'c'), 'stato-b.txt': 'rotto\n', 'stato-c.txt': 'rotto\n',
  }, { ramo });
  const r = withCritique(withRequest({}, ramo, { request: 'richiesta di prova', sha: t.avvio }), ramo, {
    critique: 'Provato il giro, riassunto.\n[2i] la cosa a non funziona.\n[1i?] scelta di gusto sulla b.\n[1i] la cosa c non funziona.',
    sha: t.critica, caps: { cap3: 2, cap2: 2, cap1: 1, cap0: 0 },
  });
  assert.equal(r.outcome, 'fix', r.reason);
  mkdirSync(resolve(t.dir, '.claude'), { recursive: true });
  writeFileSync(resolve(t.dir, '.claude', 'verify-local.json'), JSON.stringify(r.state));
  const env = { FILO_REPO_ROOT: t.dir, DISPLAY: process.env.DISPLAY || ':0', PATH: `${resolve(t.dir, 'bin')}${delimiter}${process.env.PATH}` };
  const entry = () => JSON.parse(readFileSync(resolve(t.dir, '.claude', 'verify-local.json'), 'utf8'))[ramo];
  try {
    t.scrivi(file, `import { banco } from './helpers/banco.mjs';\ntest('caso c', () => {\n});\n`);
    t.commit('pulizia: tolto b e la verifica di c');
    const no = await esegui('verify-local.mjs', ['pulizia'], env, t.dir);
    assert.notEqual(no.code, 0, no.testo);
    assert.match(no.testo, /«caso c» era rosso ed è verde/);
    assert.equal(entry().pending.shaPulizia, undefined);
    t.scrivi(file, `import { banco } from './helpers/banco.mjs';\n${caso('caso c', 'c')}`);
    const giusta = t.commit('pulizia: tolto solo il caso b');
    const si = await esegui('verify-local.mjs', ['pulizia'], env, t.dir);
    assert.equal(si.code, 0, si.testo);
    assert.equal(entry().pending.shaPulizia, giusta);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

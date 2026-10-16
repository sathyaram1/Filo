// #932: una prova del giro conta per quello che fa il suo corpo, non per il segno di rosso atteso (test.fail). Chi corregge
// il rilievo di una prova segnata e le toglie il segno, o la toglie, consegna; una segnata che fallisce ancora resta rossa.
// Playwright qui è finto, ma rovescia gli esiti dei casi segnati e scrive il rapporto come quello vero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import {
  casiDalReport, esitoDelRilancio, controllaProveTolte, controllaCasiDellaPulizia, ROSSO_ATTESO_CHIUSO,
} from '../../scripts/lib/prove-tolte.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const preparaFinto = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });

// Le forme del rapporto JSON di Playwright 1.x per i quattro esiti, lette da una corsa vera con --retries=1.
const corsa = (expectedStatus, status, ...risultati) => ({ expectedStatus, status, results: risultati.map((s) => ({ status: s })) });
const rapporto = (...specs) => ({ suites: [{ title: 'giro1-r1-x.spec.mjs', specs, suites: [] }], errors: [] });
const SEGNATO_PASSA = { title: 'segnato che passa', ok: false, tests: [corsa('failed', 'unexpected', 'passed', 'passed')] };
const SEGNATO_FALLISCE = { title: 'segnato che fallisce', ok: true, tests: [corsa('failed', 'expected', 'failed')] };
const VERDE = { title: 'verde', ok: true, tests: [corsa('passed', 'expected', 'passed')] };
const ROSSO = { title: 'rosso', ok: false, tests: [corsa('passed', 'unexpected', 'failed', 'failed')] };

test('un caso segnato come rosso atteso è verde se il corpo passa, rosso se fallisce ancora', () => {
  assert.deepEqual(casiDalReport(rapporto(SEGNATO_PASSA, SEGNATO_FALLISCE, VERDE, ROSSO)),
    { 'segnato che passa': true, 'segnato che fallisce': false, verde: true, rosso: false });
  assert.deepEqual(casiDalReport(rapporto({ title: 'senza corse', ok: false })), { 'senza corse': false }, 'senza le corse decide ok');
  const saltato = { title: 'saltato', ok: true, tests: [corsa('failed', 'skipped', 'skipped')] };
  assert.deepEqual(casiDalReport(rapporto(saltato)), { saltato: true }, 'un caso saltato non è rosso, segnato o no');
});

test('l\'uscita 1 di Playwright che spiegano solo rossi attesi col corpo verde non è una prova rossa', () => {
  assert.deepEqual(esitoDelRilancio(1, rapporto(SEGNATO_PASSA, VERDE)), { rossa: false, casi: { 'segnato che passa': true, verde: true }, attesi: [] });
  const aperta = esitoDelRilancio(0, rapporto(SEGNATO_FALLISCE, VERDE));
  assert.equal(aperta.rossa, true, 'Playwright esce 0, ma il corpo segnato fallisce ancora: la porta è aperta');
  assert.deepEqual(aperta.attesi, ['segnato che fallisce']);
  assert.equal(esitoDelRilancio(1, rapporto(SEGNATO_PASSA, ROSSO)).rossa, true, 'un rosso vero accanto resta rosso');
  assert.equal(esitoDelRilancio(1, { ...rapporto(SEGNATO_PASSA), errors: [{ message: 'un altro file non carica' }] }).rossa, true);
  assert.equal(esitoDelRilancio(1, { suites: [], errors: [{ message: 'non carica' }] }).rossa, true, 'un file che non carica è rosso');
  assert.equal(esitoDelRilancio(0, rapporto(VERDE)).rossa, false);
  assert.equal(esitoDelRilancio(1, null).rossa, true, 'senza rapporto decide l\'uscita');
  assert.equal(esitoDelRilancio(0, null).rossa, false);
  assert.equal(esitoDelRilancio(null, rapporto(VERDE)).rossa, true, 'un processo ucciso non è un via libera');
});

// Il finto Playwright: un caso fallisce se un file di stato che nomina dice «rotto»; `test.fail(` prima del primo caso
// segna tutto il file, dentro un caso solo quello. Come il vero: rovescia l'esito dei segnati e ripete gli inattesi.
const NPX_FINTO = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  "const f = process.argv.find((a) => /\\.spec\\.mjs$/.test(a));",
  "const blocchi = readFileSync(f, 'utf8').split(/(?=test\\(')/);",
  "const tutto = blocchi[0].includes('test.fail(');",
  "const rotto = (b) => [...b.matchAll(/stato-([a-z])\\.txt/g)].some((m) => readFileSync(`stato-${m[1]}.txt`, 'utf8').includes('rotto'));",
  'const specs = blocchi.slice(1).map((b) => {',
  "  const segnato = tutto || b.includes('test.fail(');",
  "  const esito = rotto(b) ? 'failed' : 'passed';",
  "  const atteso = (esito === 'passed') !== segnato;",
  "  return { title: /^test\\('([^']+)'/.exec(b)[1], ok: atteso, tests: [{ expectedStatus: segnato ? 'failed' : 'passed',",
  "    status: atteso ? 'expected' : 'unexpected', results: (atteso ? [esito] : [esito, esito]).map((status) => ({ status })) }] };",
  '});',
  'if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) {',
  '  writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({ suites: [{ title: f, specs, suites: [] }], errors: [] }));',
  '}',
  "for (const s of specs) if (!s.ok) console.log(s.tests[0].expectedStatus === 'failed' ? `Expected to fail, but passed: ${s.title}` : `rosso: ${s.title}`);",
  'process.exit(specs.some((s) => !s.ok) ? 1 : 0);',
  '',
].join('\n');

const RAMO = 'claude/prova-rosso-atteso';
const CARTELLA = 'tests/verifica/locale-prova-rosso-atteso';
const PROVA = `${CARTELLA}/giro1-r1-pausa.spec.mjs`;
const SEGNO = "test.fail(true, 'rilievo 1 aperto: il pannello cancella la frase della pausa');";
const caso = (titolo, x, segno = '') => `test('${titolo}', () => {${segno ? ` ${segno}` : ''} expect(readFileSync('stato-${x}.txt', 'utf8')).toContain('corretto'); });\n`;

function giro(prove, critica = 'Provato il pannello della pausa, il resto funziona.\n[2i] Il pannello cancella la frase della pausa appena la scrivi.') {
  const dir = cartellaTemporanea('rosso-atteso-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', RAMO);
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', '.claude/\ntests/verifica/_tolte-*/\nbin/\n');
  scrivi('bin/npx.mjs', NPX_FINTO);
  scrivi('bin/npx.cmd', `@"${process.execPath}" "%~dp0npx.mjs" %*\r\n`);
  scrivi('bin/npx', `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/npx.mjs" "$@"\n`);
  chmodSync(resolve(dir, 'bin', 'npx'), 0o755);
  scrivi('stato-a.txt', 'rotto\n'); scrivi('stato-b.txt', 'rotto\n');
  g('add', '-A'); g('commit', '-qm', 'avvio della verifica');
  const avvio = g('rev-parse', 'HEAD');
  for (const [f, t] of Object.entries(prove)) scrivi(f, t);
  g('add', '-A'); g('commit', '-qm', 'verifica giro 1: prove');
  const shaCritica = g('rev-parse', 'HEAD');
  const lancia = (cmd, args, opz) => spawnSync(process.execPath, [resolve(dir, 'bin', 'npx.mjs'), ...args], { cwd: opz.cwd, env: opz.env || process.env, encoding: 'utf8' });
  const commit = (m) => { g('add', '-A'); g('commit', '-qm', m); return g('rev-parse', 'HEAD'); };
  const consegna = () => controllaProveTolte({ shaPrima: shaCritica, root: dir, lancia, prepara: preparaFinto, log: () => {} });
  return { dir, g, scrivi, avvio, shaCritica, lancia, commit, consegna, critica };
}

test('il rilievo di una prova segnata corretto: togliere il segno, o la prova, non ferma la consegna', () => {
  const t = giro({ [PROVA]: `${SEGNO}\n${caso('la frase della pausa resta scritta', 'a')}` });
  try {
    t.scrivi('stato-a.txt', 'corretto\n');
    t.scrivi(PROVA, caso('la frase della pausa resta scritta', 'a'));
    t.commit('corretto il rilievo 1, tolto il segno');
    assert.deepEqual(t.consegna(), { ferma: false, testo: '' }, 'com\'era, col segno, il corpo passa: la porta è chiusa');
    t.g('rm', '-q', PROVA);
    t.commit('prova durevole al suo posto');
    assert.deepEqual(t.consegna(), { ferma: false, testo: '' });
  } finally {
    togliCartella(t.dir);
  }
});

test('una prova segnata che fallisce ancora, tolta, ferma la consegna e il rifiuto dice perché Playwright la dava verde', () => {
  const t = giro({ [PROVA]: `${SEGNO}\n${caso('la frase della pausa resta scritta', 'a')}` });
  try {
    t.g('rm', '-q', PROVA);
    t.commit('tolta senza correggere');
    const e = t.consegna();
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-r1-pausa\.spec\.mjs/);
    assert.match(e.testo, /segnata come rosso atteso \(test\.fail\)[\s\S]*conta il corpo, ed è ancora rosso/);
  } finally {
    togliCartella(t.dir);
  }
});

test('in una prova di più casi ogni caso conta per il suo corpo: un caso segnato ancora aperto la tiene rossa', () => {
  const file = `${CARTELLA}/giro1-r1-r2-pausa.spec.mjs`;
  const t = giro({ [file]: `${caso('r1 la frase resta', 'a', SEGNO)}${caso('r2 il tasto risponde', 'b', SEGNO)}` },
    'Provato il pannello.\n[2i] Il pannello cancella la frase della pausa.\n[2i] Il tasto della pausa non risponde.');
  try {
    t.scrivi('stato-a.txt', 'corretto\n');
    t.scrivi(file, `${caso('r1 la frase resta', 'a')}${caso('r2 il tasto risponde', 'b', SEGNO)}`);
    t.commit('corretto r1, tolto il suo segno');
    const e = t.consegna();
    assert.equal(e.ferma, true, 'com\'era, il caso di r2 fallisce ancora: Playwright lo dà verde, ma la porta è aperta');
    assert.match(e.testo, /ancora rosso \(giro1-r1-r2-pausa\.spec\.mjs\)/);
    t.scrivi('stato-b.txt', 'corretto\n');
    t.commit('corretto anche r2');
    assert.deepEqual(t.consegna(), { ferma: false, testo: '' });
  } finally {
    togliCartella(t.dir);
  }
});

test('una prova segnata accanto a un caso verde: tolto il segno dopo la correzione, la consegna passa', () => {
  const file = `${CARTELLA}/giro1-r1-pausa-e-tasto.spec.mjs`;
  const t = giro({ [file]: `${caso('r1 la frase resta', 'a', SEGNO)}${caso('il tasto risponde', 'c')}`, 'stato-c.txt': 'corretto\n' });
  try {
    t.scrivi('stato-a.txt', 'corretto\n');
    t.scrivi(file, `${caso('r1 la frase resta', 'a')}${caso('il tasto risponde', 'c')}`);
    t.commit('corretto r1, tolto il segno');
    assert.deepEqual(t.consegna(), { ferma: false, testo: '' });
  } finally {
    togliCartella(t.dir);
  }
});

test('la pulizia non toglie il caso segnato di un rilievo da correggere al posto di quello messo da parte', () => {
  const file = `${CARTELLA}/giro1-r1-r2-pausa.spec.mjs`;
  const t = giro({ [file]: `${caso('r1 la frase resta', 'a', SEGNO)}${caso('r2 il bordo è caldo', 'b')}` },
    'Provato il pannello.\n[2i] Il pannello cancella la frase della pausa.\n[1i?] Il bordo è freddo: scelta di gusto?');
  try {
    t.scrivi(file, caso('r2 il bordo è caldo', 'b'));
    const sha = t.commit('pulizia sbagliata: tolto il caso di r1');
    const e = controllaCasiDellaPulizia({ shaCritica: t.shaCritica, sha, root: t.dir, lancia: t.lancia, prepara: preparaFinto, log: () => {}, messi: [2] });
    assert.equal(e.ferma, true, 'il caso di r1, segnato, ha il corpo rosso: è un rilievo da correggere');
    assert.match(e.testo, /«r1 la frase resta»/);
  } finally {
    togliCartella(t.dir);
  }
});

// Il caso del 03/10 (#765, #896, #913), con verify-local vero: chi verifica segna la prova, corregge lui il rilievo nella
// fase 2, le toglie il segno e consegna.
const { withRequest, withCritique } = await import('../../scripts/verify-local.mjs');
const REPORT = 'Corretto il rilievo 1: il pannello della pausa non cancella più la frase. Tolto il segno di rosso atteso dalla sua prova.';

function giroLocale(prova) {
  const t = giro({ [PROVA]: prova });
  const r = withCritique(withRequest({}, RAMO, { request: 'la pausa del server si scrive dal pannello', sha: t.avvio }), RAMO, {
    critique: t.critica, sha: t.shaCritica, caps: { cap3: 2, cap2: 2, cap1: 1, cap0: 0 },
  });
  assert.equal(r.outcome, 'fix', r.reason);
  mkdirSync(resolve(t.dir, '.claude'), { recursive: true });
  writeFileSync(resolve(t.dir, '.claude', 'verify-local.json'), JSON.stringify(r.state));
  const vl = (...args) => {
    const p = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'verify-local.mjs'), ...args], {
      cwd: t.dir, encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: t.dir, DISPLAY: process.env.DISPLAY || ':0', PATH: `${resolve(t.dir, 'bin')}${delimiter}${process.env.PATH}` },
    });
    const entry = JSON.parse(readFileSync(resolve(t.dir, '.claude', 'verify-local.json'), 'utf8'))[RAMO];
    return { status: p.status, testo: `${p.stdout}\n${p.stderr}`, entry };
  };
  return { ...t, vl };
}

test('in locale chi corregge il rilievo di una prova segnata e le toglie il segno consegna con «corretto»', () => {
  const t = giroLocale(`${SEGNO}\n${caso('la frase della pausa resta scritta', 'a')}`);
  try {
    t.scrivi('stato-a.txt', 'corretto\n');
    t.scrivi(PROVA, caso('la frase della pausa resta scritta', 'a'));
    t.commit('corretto il rilievo 1');
    const c = t.vl('corretto', REPORT);
    assert.equal(c.status, 0, c.testo);
    assert.match(c.testo, /Correzione consegnata/);
    assert.equal(c.entry.verdict, 'fixed');
    const prossimo = spawnSync(process.execPath, [resolve(t.dir, 'bin', 'npx.mjs'), 'playwright', 'test', PROVA], { cwd: t.dir, encoding: 'utf8' });
    assert.equal(prossimo.status, 0, 'il verificatore dopo la trova verde');
  } finally {
    togliCartella(t.dir);
  }
});

test('la fase 2, in cloud e in locale, dice come si tratta una prova segnata che adesso passa', async () => {
  const { verifierReplyText } = await import('../../scripts/dispatch.mjs');
  const { codaText } = await import('../../scripts/verify-local.mjs');
  const risposta = verifierReplyText({ outcome: 'fix', phase2: { findings: [{ level: 2, text: 'rotto', n: 1 }], derived: [] } });
  const coda = codaText({ findings: [{ level: 2, text: 'rotto', n: 1 }], derived: [], external: [], budgets: {}, branch: RAMO });
  for (const testo of [risposta, coda]) assert.ok(testo.includes(ROSSO_ATTESO_CHIUSO));
});

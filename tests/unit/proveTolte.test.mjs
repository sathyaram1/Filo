// Chi corregge non può cancellare una prova del giro ancora rossa: la consegna la rilancia e si ferma.
// Le prove dei rilievi messi da parte escono prima, nella pulizia. Playwright qui è finto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import {
  proveTolte, percorsoRipristino, esitoProveTolte, controllaProveTolte, controllaPulizia, baseDelConfronto,
  PREFISSO_RIPRISTINO, testoPuliziaTroppoLarga,
} from '../../scripts/lib/prove-tolte.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const preparaFinto = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });

test('contano solo le prove raccolte dentro una cartella di giro', () => {
  assert.deepEqual(proveTolte([
    'tests/verifica/679/giro1-a.spec.mjs',
    'tests/verifica/679/helpers/banco.mjs',
    'tests/verifica/584/giro1-regole-motore-vero.mjs',
    'tests/boot.spec.mjs',
    'tests/verifica/a.spec.mjs',
    `tests/verifica/${PREFISSO_RIPRISTINO}679-1/giro1-a.spec.mjs`,
    'tests\\verifica\\locale-x\\sub\\b.spec.js',
  ]), ['tests/verifica/679/giro1-a.spec.mjs', 'tests/verifica/locale-x/sub/b.spec.js']);
});

test('la copia rimessa sta alla stessa profondità, così gli import relativi risolvono uguali', () => {
  const p = percorsoRipristino('tests/verifica/679/sub/a.spec.mjs', '42');
  assert.equal(p, `tests/verifica/${PREFISSO_RIPRISTINO}679-42/sub/a.spec.mjs`);
  assert.equal(p.split('/').length, 'tests/verifica/679/sub/a.spec.mjs'.split('/').length);
});

test('la cartella delle copie è gitignorata: il salvataggio automatico non la committa', () => {
  const out = execFileSync('git', ['check-ignore', '-q', '--no-index', `tests/verifica/${PREFISSO_RIPRISTINO}679-1/a.spec.mjs`], { cwd: ROOT, stdio: 'ignore' });
  assert.equal(out, null);
});

test('una prova tolta ancora rossa ferma la consegna, sempre: niente eccezione per i rilievi messi da parte', () => {
  const e = esitoProveTolte({ rosse: ['tests/verifica/679/a.spec.mjs'], shaPrima: 'abcdef1234567890' });
  assert.equal(e.ferma, true);
  assert.match(e.testo, /tests\/verifica\/679\/a\.spec\.mjs/);
  assert.match(e.testo, /git checkout abcdef123456 -- <file>/);
  // Il vecchio lasciapassare non esiste più: un argomento in più non lo riapre.
  assert.equal(esitoProveTolte({ rosse: ['tests/verifica/679/a.spec.mjs'], messiDaParte: 2 }).ferma, true);
  assert.deepEqual(esitoProveTolte({ rosse: [] }), { ferma: false, testo: '' });
});

test('senza pulizia registrata la consegna si ferma lo stesso, ma non racconta una pulizia che non c\'è stata', () => {
  const rosse = ['tests/verifica/679/b.spec.mjs'];
  const senza = esitoProveTolte({ rosse, shaPrima: 'abcdef1234567890', conPulizia: false, messi: 1 });
  assert.equal(senza.ferma, true);
  assert.doesNotMatch(senza.testo, /nel commit della pulizia/);
  assert.match(senza.testo, /Nessuna pulizia è stata registrata/);
  assert.match(senza.testo, /lasciala lì/);
  const niente = esitoProveTolte({ rosse, shaPrima: 'abcdef1234567890', conPulizia: false, messi: 0 });
  assert.equal(niente.ferma, true);
  assert.doesNotMatch(niente.testo, /pulizia|messo da parte/);
  assert.match(esitoProveTolte({ rosse, conPulizia: true }).testo, /nel commit della pulizia/);
});

test('la pulizia non toglie più prove dei rilievi messi da parte, contando anche quelle di una pulizia prima', () => {
  assert.equal(testoPuliziaTroppoLarga(['tests/verifica/9/giro1-b.spec.mjs'], 1), '');
  const due = testoPuliziaTroppoLarga(['tests/verifica/9/giro1-b.spec.mjs', 'tests/verifica/9/giro1-c.spec.mjs'], 1);
  assert.match(due, /sono uscite 2 prove del giro, ma i rilievi messi da parte sono 1/);
  assert.match(due, /giro1-c\.spec\.mjs/);
  assert.notEqual(testoPuliziaTroppoLarga(['tests/verifica/9/a.spec.mjs'], 0), '');
});

test('in un repo vero la pulizia che toglie anche la prova rossa di un rilievo da correggere è respinta', () => {
  const dir = cartellaTemporanea('pulizia-larga-');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'prova');
    git('config', 'user.email', 'prova@example.invalid');
    mkdirSync(resolve(dir, 'tests', 'verifica', '9'), { recursive: true });
    for (const l of ['b', 'c']) writeFileSync(resolve(dir, 'tests', 'verifica', '9', `giro1-${l}.spec.mjs`), `// ${l}\n`);
    git('add', '-A');
    git('commit', '-qm', 'critica');
    const critica = git('rev-parse', 'HEAD').trim();
    git('rm', '-q', 'tests/verifica/9/giro1-b.spec.mjs');
    git('commit', '-qm', 'pulizia');
    const una = controllaPulizia({ shaCritica: critica, root: dir });
    assert.equal(testoPuliziaTroppoLarga(una.files, 1), '');
    // Una seconda pulizia si misura sempre dalla critica: le prove tolte si sommano.
    git('rm', '-q', 'tests/verifica/9/giro1-c.spec.mjs');
    git('commit', '-qm', 'pulizia 2');
    const due = controllaPulizia({ shaCritica: critica, root: dir });
    assert.equal(due.files.length, 2);
    assert.notEqual(testoPuliziaTroppoLarga(due.files, 1), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function repoConProve() {
  const dir = cartellaTemporanea('prove-tolte-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', 'lavoro');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('tests/verifica/679/giro1-rossa.spec.mjs', 'ROSSA\n');
  scrivi('tests/verifica/679/giro1-verde.spec.mjs', 'VERDE\n');
  scrivi('tests/verifica/679/helpers/banco.mjs', 'AIUTO\n');
  scrivi('src/x.js', '1\n');
  g('add', '-A'); g('commit', '-qm', 'critica');
  const critica = g('rev-parse', 'HEAD');
  return { dir, g, scrivi, critica };
}

// Il finto Playwright legge la copia rimessa: rosso se dice ROSSA. Registra cosa c'era accanto.
function playwrightFinto(dir, visti) {
  return (cmd, args) => {
    const file = args.find((a) => a.endsWith('.spec.mjs'));
    const pieno = resolve(dir, file);
    visti.push({ file, aiuto: existsSync(resolve(dirname(pieno), 'helpers', 'banco.mjs')), cmd, args });
    return { status: readFileSync(pieno, 'utf8').startsWith('ROSSA') ? 1 : 0 };
  };
}

test('la consegna rilancia solo le prove tolte, com\'erano, e respinge quella ancora rossa', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    scrivi('src/x.js', 'corretto\n');
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs', 'tests/verifica/679/giro1-verde.spec.mjs');
    g('commit', '-qam', 'correzione');
    const visti = [];
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia: playwrightFinto(dir, visti), prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-rossa\.spec\.mjs/);
    assert.doesNotMatch(e.testo, /giro1-verde/);
    assert.equal(visti.length, 2, 'una corsa per prova tolta, niente di più');
    assert.ok(visti.every((v) => v.aiuto), 'la cartella torna intera: gli aiuti accanto alla prova ci sono');
    assert.ok(visti.every((v) => v.args.includes('--retries=1')));
    assert.deepEqual(readdirSync(resolve(dir, 'tests', 'verifica')), ['679'], 'le copie se ne vanno dopo la corsa');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancellare una prova diventata verde passa, e senza prove tolte non si lancia niente', () => {
  const { dir, g, critica } = repoConProve();
  try {
    const visti = [];
    const lancia = playwrightFinto(dir, visti);
    assert.deepEqual(controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto }), { ferma: false, testo: '' });
    g('rm', '-q', 'tests/verifica/679/giro1-verde.spec.mjs'); g('commit', '-qm', 'tolta la verde');
    assert.deepEqual(controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto, log: () => {} }), { ferma: false, testo: '' });
    assert.equal(visti.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('togliere il caso rosso e tenere il file ferma la consegna come cancellare la prova', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    scrivi('tests/verifica/679/giro1-rossa.spec.mjs', 'VERDE: il caso rosso non c\'è più\n');
    scrivi('tests/verifica/679/giro1-verde.spec.mjs', 'VERDE, con un commento in più\n');
    g('commit', '-qam', 'correzione che toglie il caso');
    const visti = [];
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia: playwrightFinto(dir, visti), prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true, 'la prova com\'era è ancora rossa: la porta è aperta');
    assert.match(e.testo, /giro1-rossa\.spec\.mjs/);
    assert.doesNotMatch(e.testo, /giro1-verde/, 'una prova cambiata che com\'era è verde non ferma niente');
    assert.equal(visti.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('senza schermo e senza xvfb la consegna si ferma e dice perché, invece di passare', () => {
  const { dir, g, critica } = repoConProve();
  try {
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs'); g('commit', '-qm', 'tolta');
    const e = controllaProveTolte({
      shaPrima: critica, root: dir, prepara: () => ({ ok: false, motivo: 'xvfb-run non c\'è' }), lancia: () => { throw new Error('non doveva partire'); },
    });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /xvfb-run non c'è/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Critica sulla vecchia base; poi main cambia e cancella prove di un altro lavoro, e il ramo si riallinea.
function riallineatoDopoLaCritica() {
  const dir = cartellaTemporanea('prove-tolte-riallineo-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('tests/verifica/99/giro1-cambiata.spec.mjs', 'ROSSA\n');
  scrivi('tests/verifica/99/giro1-cancellata.spec.mjs', 'ROSSA\n');
  g('add', '-A'); g('commit', '-qm', 'main: un altro lavoro');
  g('checkout', '-q', '-b', 'lavoro');
  scrivi('tests/verifica/679/giro1-rossa.spec.mjs', 'ROSSA\n');
  scrivi('tests/verifica/679/giro1-verde.spec.mjs', 'VERDE\n');
  scrivi('src/x.js', '1\n');
  g('add', '-A'); g('commit', '-qm', 'critica');
  const critica = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  scrivi('tests/verifica/99/giro1-cambiata.spec.mjs', 'VERDE: l\'altro lavoro ha tolto il suo caso\n');
  g('rm', '-q', 'tests/verifica/99/giro1-cancellata.spec.mjs');
  g('commit', '-qam', 'main: l\'altro lavoro svuota la sua cartella');
  g('checkout', '-q', 'lavoro');
  g('rebase', '-q', 'main');
  return { dir, g, scrivi, critica };
}

test('dopo un riallineamento le prove che ha cambiato main non entrano nel rilancio; quelle del ramo sì', () => {
  const { dir, g, scrivi, critica } = riallineatoDopoLaCritica();
  try {
    scrivi('src/x.js', 'corretto\n');
    g('commit', '-qam', 'correzione che non tocca prove');
    const visti = [];
    const lancia = playwrightFinto(dir, visti);
    assert.deepEqual(controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto, log: () => {} }), { ferma: false, testo: '' });
    assert.equal(visti.length, 0, 'le prove dell\'altro lavoro non sono state rilanciate');
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs'); g('commit', '-qm', 'tolta la rossa');
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true, 'la prova rossa tolta dal ramo ferma ancora la consegna');
    assert.match(e.testo, /679\/giro1-rossa\.spec\.mjs/);
    assert.doesNotMatch(e.testo, /tests\/verifica\/99\//);
    assert.deepEqual(visti.map((v) => v.file.split('/').pop()), ['giro1-rossa.spec.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dopo un riallineamento una prova già su main che il ramo cambia entra ancora nel rilancio', () => {
  const { dir, g, scrivi, critica } = riallineatoDopoLaCritica();
  try {
    scrivi('tests/verifica/99/giro1-cambiata.spec.mjs', 'VERDE: ritoccata anche dal ramo\n');
    g('commit', '-qam', 'il ramo tocca una prova che main aveva già cambiato');
    const visti = [];
    controllaProveTolte({ shaPrima: critica, root: dir, lancia: playwrightFinto(dir, visti), prepara: preparaFinto, log: () => {} });
    assert.deepEqual(visti.map((v) => v.file.split('/').pop()), ['giro1-cambiata.spec.mjs']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le due consegne, locale e routine, passano da questo controllo, con la pulizia come base', () => {
  const locale = readFileSync(resolve(ROOT, 'scripts', 'verify-local.mjs'), 'utf8');
  const routine = readFileSync(resolve(ROOT, 'scripts', 'dispatch.mjs'), 'utf8');
  assert.match(locale, /baseDelConfronto\(aperto\.pending\.sha, aperto\.pending\.shaPulizia/);
  assert.match(locale, /controllaProveTolte\(\{ shaPrima: base, root: ROOT,/);
  assert.match(routine, /baseDelConfronto\(shaCritica, guard\.state\?\.puliziaSha/);
  assert.match(routine, /controllaProveTolte\(\{\s*shaPrima: baseTolte/);
  assert.doesNotMatch(`${locale}\n${routine}`, /messiDaParte:/, 'nessuna delle due passa più un lasciapassare');
});

// ─── La pulizia: le prove dei rilievi messi da parte escono prima della correzione ───

test('la pulizia accetta solo prove o casi tolti, da una cartella del giro', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    assert.match(controllaPulizia({ shaCritica: critica, root: dir }).motivo, /nessun commit dopo la critica/);
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs'); g('commit', '-qm', 'pulizia');
    const ok = controllaPulizia({ shaCritica: critica, root: dir, cartella: 'tests/verifica/679' });
    assert.equal(ok.ok, true, ok.motivo);
    assert.equal(ok.sha, g('rev-parse', 'HEAD'));
    assert.deepEqual(ok.files, ['tests/verifica/679/giro1-rossa.spec.mjs']);
    assert.equal(controllaPulizia({ shaCritica: critica, root: dir, cartella: 'tests/verifica/locale-altro' }).ok, false,
      'una cartella che non è quella del giro non si pulisce da qui');
    scrivi('src/x.js', 'una correzione infilata nella pulizia\n');
    g('commit', '-qam', 'correzione');
    const no = controllaPulizia({ shaCritica: critica, root: dir });
    assert.equal(no.ok, false);
    assert.match(no.motivo, /solo togliere prove del giro[\s\S]*src\/x\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('una riga aggiunta a una prova del giro non è una pulizia', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    scrivi('tests/verifica/679/giro1-rossa.spec.mjs', 'ROSSA\ntest.fail(true)\n');
    g('commit', '-qam', 'marcatore');
    assert.equal(controllaPulizia({ shaCritica: critica, root: dir }).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dopo la pulizia la base è lei: la prova messa da parte non si rilancia, una rossa tolta dopo ferma', () => {
  const { dir, g, scrivi, critica } = repoConProve();
  try {
    scrivi('tests/verifica/679/giro1-messa-da-parte.spec.mjs', 'ROSSA\n');
    g('add', '-A'); g('commit', '-qm', 'critica, con la prova di un rilievo che il server mette da parte');
    const critica2 = g('rev-parse', 'HEAD');
    g('rm', '-q', 'tests/verifica/679/giro1-messa-da-parte.spec.mjs'); g('commit', '-qm', 'pulizia');
    const pulizia = g('rev-parse', 'HEAD');
    assert.equal(baseDelConfronto(critica2, pulizia, dir), pulizia);
    assert.equal(baseDelConfronto(critica2, '', dir), critica2);
    assert.equal(baseDelConfronto(pulizia, critica, dir), pulizia, 'una pulizia di un giro vecchio non sposta la base');
    scrivi('src/x.js', 'corretto\n'); g('commit', '-qam', 'correzione');
    const visti = [];
    const lancia = playwrightFinto(dir, visti);
    assert.deepEqual(controllaProveTolte({ shaPrima: pulizia, root: dir, lancia, prepara: preparaFinto, log: () => {} }), { ferma: false, testo: '' });
    assert.equal(visti.length, 0, 'la prova uscita nella pulizia non è della correzione');
    g('rm', '-q', 'tests/verifica/679/giro1-rossa.spec.mjs'); g('commit', '-qm', 'tolta anche una rossa');
    const e = controllaProveTolte({ shaPrima: pulizia, root: dir, lancia, prepara: preparaFinto, log: () => {} });
    assert.equal(e.ferma, true);
    assert.match(e.testo, /giro1-rossa\.spec\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Il caso di tests/verifica/locale-attriti-verifica/giro1: un rilievo esterno nel giro non apre più la porta.
// Processo vero di verify-local, npx finto che risponde rosso a ogni prova.
function giroLocaleAperto({ external = [], derived = [] } = {}) {
  const dir = cartellaTemporanea('giro-locale-prove-tolte-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  const ramo = 'claude/prova-giro';
  const cartella = 'tests/verifica/locale-prova-giro';
  g('init', '-q', '-b', ramo);
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', '.claude/\ntests/verifica/_tolte-*/\nbin/\n');
  scrivi(`${cartella}/giro1-rilievo.spec.mjs`, 'rossa\n');
  scrivi(`${cartella}/giro1-messo-da-parte.spec.mjs`, 'rossa\n');
  g('add', '-A'); g('commit', '-qm', 'critica');
  const critica = g('rev-parse', 'HEAD');
  scrivi('bin/npx.cmd', '@echo prova rossa\r\n@exit /b 1\r\n');
  scrivi('bin/npx', '#!/bin/sh\necho prova rossa\nexit 1\n');
  chmodSync(resolve(dir, 'bin', 'npx'), 0o755);
  const stato = (extra = {}) => writeFileSync(resolve(dir, '.claude', 'verify-local.json'), JSON.stringify({
    [ramo]: {
      request: 'correggi il pulsante', verdict: 'fix-pending', rounds: [{ outcome: '' }],
      pending: {
        sha: critica, at: new Date().toISOString(), budgets: null, derived, external,
        findings: [{ level: 2, sede: 'i', text: 'Il pulsante non salva col titolo vuoto' }], ...extra,
      },
    },
  }));
  mkdirSync(resolve(dir, '.claude'), { recursive: true });
  stato();
  const vl = (...args) => {
    const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'verify-local.mjs'), ...args], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, FILO_REPO_ROOT: dir, DISPLAY: process.env.DISPLAY || ':0', PATH: `${resolve(dir, 'bin')}${delimiter}${process.env.PATH}` },
    });
    const entry = JSON.parse(readFileSync(resolve(dir, '.claude', 'verify-local.json'), 'utf8'))[ramo];
    return { status: r.status, testo: `${r.stdout}\n${r.stderr}`, entry };
  };
  return { dir, g, scrivi, cartella, critica, vl };
}

const REPORT = 'Corretto il rilievo del giro: il pulsante ora salva anche col titolo vuoto, provato a mano e con la prova.';

test('con un rilievo esterno nel giro, una prova cancellata ancora rossa ferma lo stesso la consegna', () => {
  const { dir, g, scrivi, cartella, vl } = giroLocaleAperto({ external: [{ level: 1, sede: 'e', text: 'Il bordo del menu è grigio' }] });
  try {
    g('rm', '-q', `${cartella}/giro1-rilievo.spec.mjs`);
    scrivi('codice.js', 'module.exports = 1;\n');
    g('add', '-A'); g('commit', '-qm', 'correzione');
    const r = vl('corretto', REPORT);
    assert.notEqual(r.status, 0, r.testo);
    assert.match(r.testo, /giro1-rilievo\.spec\.mjs/);
    assert.equal(r.entry.verdict, 'fix-pending', 'la consegna respinta non chiude il giro');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('in locale la pulizia si registra, e la consegna dopo non rilancia la prova messa da parte', () => {
  const derived = [{ level: 1, sede: 'i', text: 'Il bordo è freddo', priority: 1 }];
  const { dir, g, scrivi, cartella, vl } = giroLocaleAperto({ derived });
  try {
    g('rm', '-q', `${cartella}/giro1-messo-da-parte.spec.mjs`); g('commit', '-qm', 'pulizia del giro');
    const pulizia = g('rev-parse', 'HEAD');
    const p = vl('pulizia');
    assert.equal(p.status, 0, p.testo);
    assert.equal(p.entry.pending.shaPulizia, pulizia);
    scrivi('codice.js', 'module.exports = 1;\n');
    g('add', '-A'); g('commit', '-qm', 'correzione');
    const c = vl('corretto', REPORT);
    assert.equal(c.status, 0, c.testo);
    assert.equal(c.entry.verdict, 'fixed');
    assert.equal(c.entry.chiusura.shaPrima, pulizia, 'la verifica dopo guarda la correzione, non la pulizia');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('in locale la pulizia si rifiuta senza rilievi messi da parte, o se il commit porta altro', () => {
  const { dir, g, scrivi, cartella, vl } = giroLocaleAperto();
  try {
    g('rm', '-q', `${cartella}/giro1-rilievo.spec.mjs`); g('commit', '-qm', 'tolta la rossa da correggere');
    const p = vl('pulizia');
    assert.notEqual(p.status, 0);
    assert.match(p.testo, /non ha messo da parte nessun rilievo/);
    assert.equal(p.entry.pending.shaPulizia, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const altro = giroLocaleAperto({ derived: [{ level: 1, sede: 'i', text: 'x', priority: 1 }] });
  try {
    altro.g('rm', '-q', `${altro.cartella}/giro1-messo-da-parte.spec.mjs`);
    altro.scrivi('codice.js', 'una correzione\n');
    altro.g('add', '-A'); altro.g('commit', '-qm', 'pulizia e correzione insieme');
    const p = altro.vl('pulizia');
    assert.notEqual(p.status, 0);
    assert.match(p.testo, /codice\.js/);
  } finally {
    rmSync(altro.dir, { recursive: true, force: true });
  }
});

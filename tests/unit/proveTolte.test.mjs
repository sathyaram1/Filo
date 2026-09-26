// Chi corregge non può cancellare una prova del giro ancora rossa: la consegna la rilancia e si ferma.
// Playwright qui è finto: si guarda cosa viene rimesso, cosa viene lanciato e cosa decide la consegna.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import {
  proveTolte, percorsoRipristino, esitoProveTolte, controllaProveTolte, PREFISSO_RIPRISTINO,
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

test('una prova tolta ancora rossa ferma la consegna, se il giro non ha messo niente da parte', () => {
  const e = esitoProveTolte({ rosse: ['tests/verifica/679/a.spec.mjs'], messiDaParte: 0, shaPrima: 'abcdef1234567890' });
  assert.equal(e.ferma, true);
  assert.match(e.testo, /tests\/verifica\/679\/a\.spec\.mjs/);
  assert.match(e.testo, /git checkout abcdef123456 -- <file>/);
});

test('con rilievi messi da parte le rosse si elencano ma non fermano: la loro prova si cancella rossa', () => {
  const e = esitoProveTolte({ rosse: ['tests/verifica/679/a.spec.mjs'], messiDaParte: 2 });
  assert.equal(e.ferma, false);
  assert.match(e.testo, /tests\/verifica\/679\/a\.spec\.mjs/);
  assert.deepEqual(esitoProveTolte({ rosse: [], messiDaParte: 0 }), { ferma: false, testo: '' });
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

test('le due consegne, locale e routine, passano da questo controllo', () => {
  const locale = readFileSync(resolve(ROOT, 'scripts', 'verify-local.mjs'), 'utf8');
  const routine = readFileSync(resolve(ROOT, 'scripts', 'dispatch.mjs'), 'utf8');
  assert.match(locale, /controllaProveTolte\(\{ shaPrima: aperto\.pending\.sha/);
  assert.match(routine, /controllaProveTolte\(\{\s*shaPrima: shaCritica/);
});

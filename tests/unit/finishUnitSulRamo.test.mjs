// `npm run finish` vero, in un repo usa-e-getta con origin: un unit rosso sul ramo da solo ma già corretto su main
// arriva a chiedere la fusione, uno rotto dal ramo resta fermo (#1009). Nessuna credenziale passa al figlio: la
// richiesta al server non parte mai. Le regole stanno in esitoUnitDelRamo (scripts/finish-local.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Quello che finish-local importa, fino in fondo: il repo finto deve poterlo lanciare com'è.
const SERVONO = ['scripts', 'src/shared', 'src/main/auth', 'src/main/services/mergeApprovalSignal.js'];

const TEST_VALORE = "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { readFileSync } from 'node:fs';\n"
  + "test('il valore è uno', () => assert.equal(readFileSync('valore.txt', 'utf8').trim(), 'uno'));\n";

function repoFinto() {
  const casa = cartellaTemporanea('filo-1009-');
  const origin = join(casa, 'origin.git');
  const lavoro = join(casa, 'lavoro');
  const senzaHook = join(casa, 'nessun-hook');
  mkdirSync(senzaHook);
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin]);
  const tracciati = execFileSync('git', ['ls-files', '-z', '--', ...SERVONO], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const f of tracciati) {
    mkdirSync(dirname(join(lavoro, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(lavoro, f));
  }
  const scrivi = (file, testo) => { mkdirSync(dirname(join(lavoro, file)), { recursive: true }); writeFileSync(join(lavoro, file), testo, 'utf8'); };
  scrivi('package.json', JSON.stringify({ name: 'finto', version: '0.0.1', private: true, scripts: { 'test:unit': 'node scripts/run-unit-tests.mjs' } }));
  scrivi('.gitignore', 'node_modules\n.claude\n');
  scrivi('valore.txt', 'zero\n');
  scrivi('tests/unit/valore.test.mjs', TEST_VALORE);
  const git = (...a) => execFileSync('git', a, { cwd: lavoro, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '--initial-branch=main');
  for (const [k, v] of [['user.email', 't@t'], ['user.name', 't'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.hooksPath', senzaHook]]) git('config', k, v);
  git('add', '-A');
  git('commit', '-qm', 'base: main nasce con un unit rosso');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  const commit = (msg) => { git('add', '-A'); git('commit', '-qm', msg); return git('rev-parse', 'HEAD'); };
  return { casa, lavoro, git, scrivi, commit };
}

/** Il verdetto superato della verifica locale e la pratica, come li scrive verify-local. */
function verificato(r, rami) {
  const stato = Object.fromEntries(rami.map(([ramo, sha], i) => [ramo, { verdict: 'pass', sha, feedbackId: `finto${i}`, feedbackNum: 1009 }]));
  r.scrivi('.claude/verify-local.json', JSON.stringify(stato));
}

function finish(r, ...argomenti) {
  const env = { ...process.env, FILO_ROUTINE_API: 'http://127.0.0.1:9' };
  // Dentro `node --test` i test del repo finto diventerebbero figli di questo; le variabili di npm porterebbero il
  // `npm run` annidato al package.json vero; le credenziali farebbero partire la richiesta vera.
  for (const k of Object.keys(env)) {
    if (k === 'NODE_TEST_CONTEXT' || k === 'INIT_CWD' || /^npm_/i.test(k)) delete env[k];
  }
  for (const k of ['FILO_ADMIN_REFRESH_TOKEN', 'FILO_SA_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[k];
  const p = spawnSync(process.execPath, [join('scripts', 'finish-local.mjs'), ...argomenti], {
    cwd: r.lavoro, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  return { status: p.status, out: `${p.stdout || ''}\n${p.stderr || ''}` };
}

test('finish: un unit rosso già corretto su main arriva a chiedere la fusione senza riallineare il ramo; uno rotto dal ramo resta fermo', () => {
  const r = repoFinto();
  try {
    r.git('checkout', '-q', '-b', 'claude/vecchio');
    r.scrivi('innocuo.txt', 'x\n');
    const vecchio = r.commit('il ramo nasce prima della correzione');
    r.git('checkout', '-q', 'main');
    r.scrivi('valore.txt', 'uno\n');
    r.commit('main corregge il rosso');
    r.git('push', '-q', 'origin', 'main');
    r.git('checkout', '-q', '-b', 'claude/rompe');
    r.scrivi('valore.txt', 'due\n');
    const rompe = r.commit('il ramo rompe il test');
    verificato(r, [['claude/vecchio', vecchio], ['claude/rompe', rompe]]);

    r.git('checkout', '-q', 'claude/vecchio');
    const base = r.git('merge-base', 'claude/vecchio', 'main').slice(0, 8);
    const mainOra = r.git('rev-parse', 'main').slice(0, 8);
    const v = finish(r);
    assert.match(v.out, /Controlli di logica rossi sul ramo da solo, ma sul risultato della fusione con main [0-9a-f]{8}, che è ciò che arriva su main, sono verdi: non sono del ramo, proseguo\./, v.out);
    assert.ok(v.out.includes(`Il ramo parte da main ${base}, più vecchio`), `la base del ramo, dove il rosso c'è ancora, si nomina:\n${v.out}`);
    assert.ok(v.out.includes(`su main da solo si usa ${mainOra}, non la base del ramo`), v.out);
    assert.doesNotMatch(v.out, /non pubblico/, v.out);
    assert.match(v.out, /Chiedo al server di fondere/, 'arriva alla richiesta di fusione');
    assert.equal(v.out.match(/▸ Unit sul risultato della fusione con main/g).length, 1, 'la prova sulla fusione gira una volta sola, non di nuovo prima della richiesta');
    assert.equal(r.git('rev-parse', 'HEAD'), vecchio, 'il ramo non si è mosso: il verdetto resta legato al suo sha');
    assert.equal(r.git('rev-list', '--count', 'HEAD..origin/main'), '1', 'main non è stato fuso nel ramo');

    const c = finish(r, '--check');
    assert.equal(c.status, 0, c.out);
    assert.match(c.out, /non sono del ramo, proseguo[\s\S]*Controlli passati/);

    r.git('checkout', '-q', 'claude/rompe');
    const f = finish(r);
    assert.equal(f.status, 1, f.out);
    assert.match(f.out, /✗ Unit sul ramo, che contiene già main [0-9a-f]{8}: rossi[\s\S]*tests\/unit\/valore\.test\.mjs › il valore è uno/, f.out);
    assert.match(f.out, /Controlli di logica rossi: rossi sul ramo, che contiene già main, e su main da solo passano; non pubblico/);
    assert.doesNotMatch(f.out, /Chiedo al server/);

    const k = finish(r, '--check');
    assert.equal(k.status, 1, k.out);
    assert.match(k.out, /esito finale resta rosso/);
    assert.doesNotMatch(k.out, /Controlli passati/);
  } finally {
    togliCartella(r.casa);
  }
});

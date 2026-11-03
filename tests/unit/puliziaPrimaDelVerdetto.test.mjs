// #1555: la pulizia che non dipende dall'esito si fa PRIMA del verdetto, nel commit della critica. Dopo, il commit entra
// nel registro della fiducia solo se lo spinge il rilascio (#2021): un commit in meno da far quadrare.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { esceInOgniEsito, proveDaToglierePrimaDelVerdetto, proveScritteDa } from '../../scripts/lib/prove-tolte.mjs';
import { verifierReplyText } from '../../scripts/dispatch.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('escono in ogni esito gli esterni e i `?` che contano al più 1; gli altri dipendono dai bilanci', () => {
  assert.equal(esceInOgniEsito({ level: 3, sede: 'e' }), true);
  assert.equal(esceInOgniEsito({ level: 1, sede: 'i', decision: true }), true);
  assert.equal(esceInOgniEsito({ level: 3, sede: 'v', decision: true }), true, 'un vicino col ? esce sempre');
  assert.equal(esceInOgniEsito({ level: 2, sede: 'i', decision: true }), false, 'un 2 col ? si corregge con la consigliata: la prova resta');
  assert.equal(esceInOgniEsito({ level: 1, sede: 'i' }), false, 'un 1 si corregge o esce secondo il bilancio');
  assert.equal(esceInOgniEsito({ level: 0, sede: 'v' }), false);
});

test('fra le prove scritte, si tolgono prima solo quelle coi soli numeri di rilievi che escono comunque', () => {
  const findings = [{ level: 2, sede: 'i' }, { level: 1, sede: 'e' }, { level: 0, sede: 'i', decision: true }];
  const fuori = proveDaToglierePrimaDelVerdetto([
    'tests/verifica/42/giro1-r1-salva.spec.mjs',
    'tests/verifica/42/giro1-r2-esterno.spec.mjs',
    'tests/verifica/42/giro1-r1-r2-misto.spec.mjs',
    'tests/verifica/42/giro1-r3-domanda.spec.mjs',
    'tests/verifica/42/giro1-chiusa.spec.mjs',
    'tests/verifica/42/aiuto.mjs',
  ], findings);
  assert.deepEqual(fuori.map((f) => f.prova), ['tests/verifica/42/giro1-r2-esterno.spec.mjs', 'tests/verifica/42/giro1-r3-domanda.spec.mjs']);
});

test('a lavoro fermo di sicuro i `?` restano a chi riprende con la loro prova: escono prima solo gli esterni', () => {
  const require = createRequire(import.meta.url);
  require('../../src/shared/feedbackTransitions.js');
  require('../../src/shared/verifierRound.js');
  const V = globalThis.SN_VERIFIER_ROUND;
  const caps = { cap3: 10, cap2: 10, cap1: 1, cap0: 0 };
  for (const critica of [
    'Provato.\n[2i?] Il riquadro è freddo?\n[1i?] Il bordo è grigio?\n[1e] Fuori.',
    'Provato.\n[3i?] I dati escono?\n[2v?] Il titolo accanto è tagliato?\n[1e] Fuori.',
  ]) {
    const { findings } = V.parseFindings(critica);
    const esito = V.decideRound({ findings, caps, counts: {} });
    assert.equal(esito.stop, true);
    assert.equal(esito.sospesi.length, 1, 'il secondo rilievo resta al lavoro');
    const fuori = proveDaToglierePrimaDelVerdetto(['tests/verifica/42/giro1-r2-sospeso.spec.mjs', 'tests/verifica/42/giro1-r3-esterno.spec.mjs'], findings);
    assert.deepEqual(fuori.map((f) => f.prova), ['tests/verifica/42/giro1-r3-esterno.spec.mjs'], critica);
  }
});

/** Un ramo con un punto fermo all'avvio della verifica e, dopo, le prove della critica. */
function ramoConProve(prove) {
  const casa = cartellaTemporanea('filo-pulizia-prima-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(casa, f)), { recursive: true }); writeFileSync(resolve(casa, f), t, 'utf8'); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  scrivi('.gitignore', 'stato/\n.claude/\n');
  scrivi('tests/verifica/901/giro1-r1-vecchia.spec.mjs', '// di un giro passato\n');
  g('add', '-A'); g('commit', '-qm', 'init');
  g('checkout', '-q', '-b', 'worker/901');
  const avvio = g('rev-parse', 'HEAD');
  for (const p of prove) scrivi(p, '// rossa\n');
  if (prove.length) { g('add', '-A'); g('commit', '-qm', 'verifica #901 giro 2: prove'); }
  mkdirSync(resolve(casa, 'stato'), { recursive: true });
  writeFileSync(resolve(casa, 'stato', 'fid-901.json'), JSON.stringify({
    id: 'fid-901', branch: 'worker/901', verifierVerdict: null, checkpoints: [{ sha: avvio, by: 'checkout' }],
  }), 'utf8');
  return { casa, avvio, g };
}

test('le prove scritte dalla verifica sono quelle aggiunte o rinominate dopo l\'avvio, non quelle che c\'erano', (t) => {
  const { casa, avvio, g } = ramoConProve(['tests/verifica/901/giro2-r1-nuova.spec.mjs']);
  t.after(() => togliCartella(casa));
  g('mv', 'tests/verifica/901/giro1-r1-vecchia.spec.mjs', 'tests/verifica/901/giro2-r2-rinominata.spec.mjs');
  g('commit', '-qm', 'rinomina');
  assert.deepEqual(proveScritteDa(avvio, casa).sort(), ['tests/verifica/901/giro2-r1-nuova.spec.mjs', 'tests/verifica/901/giro2-r2-rinominata.spec.mjs']);
});

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      ricevuti.push({ url: req.url });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, ...(req.url.includes('routineDeliver') ? { reply: { outcome: 'pass', derived: [{ level: 1, sede: 'e', text: 'esterno', num: '#901.1' }] } } : {}) }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

const esegui = (argv, casa, port) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), ...argv], {
    env: {
      ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa, FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
      FILO_ROUTINES_ENABLED: '1', FILO_ROUTINE_TICKET: 'biglietto-di-prova', FILO_ROUTINE_ROLE: 'verifier', FILO_NO_BEAT: '1',
    },
  }, (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, out: String(so || '') + String(se || '') }));
});

test('la prova di un esterno ancora nel ramo ferma la critica prima del server; tolta, il pass non chiede altri commit', async (t) => {
  const { casa, g } = ramoConProve(['tests/verifica/901/giro2-r1-esterno.spec.mjs']);
  t.after(() => togliCartella(casa));
  const { srv, ricevuti, port } = await fintoServer();
  t.after(() => srv.close());
  const critica = 'Provato il salvataggio da menu e scorciatoia: regge.\n[1e] Il menu delle schede si chiude da solo, fuori da questo lavoro.';
  const fermo = await esegui(['--record-verifier', 'fid-901', critica], casa, port);
  assert.notEqual(fermo.code, 0);
  assert.match(fermo.out, /giro2-r1-esterno\.spec\.mjs: il rilievo 1 è esterno/);
  assert.ok(!ricevuti.some((x) => x.url.includes('routineDeliver')), 'il verdetto non deve partire su una punta che poi si sposta');

  g('rm', '-q', 'tests/verifica/901/giro2-r1-esterno.spec.mjs'); g('commit', '-qm', 'verifica #901 giro 2: via la prova dell\'esterno');
  const tip = g('rev-parse', 'HEAD');
  const ok = await esegui(['--record-verifier', 'fid-901', critica], casa, port);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /verifica superata/);
  assert.doesNotMatch(ok.out, /TOGLIERE/, 'nessun commit dopo il verdetto');
  assert.match(ok.out, /il ramo non si tocca più/);
  assert.equal(g('rev-parse', 'HEAD'), tip);
});

test('dopo un pass si tolgono solo le prove dei rilievi che il bilancio ha messo da parte', () => {
  const testo = verifierReplyText({
    outcome: 'pass',
    derived: [
      { level: 2, sede: 'e', text: 'esterno.', n: 1, num: '#42.1' },
      { level: 1, sede: 'i', text: 'domanda.', decision: true, n: 2, num: '#42.2' },
      { tipo: 'rimasti', num: '#42.3', findings: [{ level: 1, sede: 'i', text: 'rimasto.', n: 3 }] },
    ],
  });
  assert.match(testo, /TOGLIERE/);
  assert.match(testo, /le prove con r3 nel nome/);
  assert.doesNotMatch(testo, /le prove con r[12] nel nome/);
});

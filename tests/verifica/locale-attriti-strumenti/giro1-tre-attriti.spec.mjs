// Prove del giro 1 (verifica locale) sui tre attriti degli strumenti delle routine: unit verdi con la
// cartella sporca, --ticket davanti a un --record-*, --ticket nella consegna del canale. Non aprono Filo:
// usano gli strumenti veri contro un server finto, su depositi git usa-e-getta (mai sulla cartella di lavoro).

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const CRITICA = 'Provato tutto: funziona come chiesto, niente da segnalare in nessuna parte del lavoro consegnato.';
const REPORT = 'Report: corretto il pulsante che non salvava, lasciato stare il resto perché fuori dalla richiesta.';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(b); } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, outcome: 'fix', expiresAt: 'dopo' }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

function deposito() {
  const d = cartellaTemporanea('attriti-strumenti-');
  git(d, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(d, 'config', k, v);
  writeFileSync(join(d, 'a.txt'), 'x\n');
  writeFileSync(join(d, '.gitignore'), 'stato/\n');
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'init');
  git(d, 'checkout', '-q', '-b', 'worker/900');
  mkdirSync(join(d, 'stato'));
  writeFileSync(join(d, 'stato', 'fid-900.json'), JSON.stringify({ id: 'fid-900', branch: 'worker/900', loopCount: 1, verifierVerdict: 'fail' }));
  return d;
}

function lancia(script, argv, port, casa) {
  return new Promise((r) => execFile(process.execPath, [resolve(ROOT, 'scripts', script), ...argv], {
    env: {
      ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa,
      FILO_NO_BEAT: '1', FILO_DISPATCH_STATE_DIR: join(casa, 'stato'), FILO_ROUTINES_ENABLED: '1',
    },
  }, (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
}

async function conServer(fn) {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = deposito();
  try { return await fn({ ricevuti, port, casa }); } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
}

test('gli unit dei due testi restano verdi a chi li lancia con modifiche non committate', async () => {
  test.setTimeout(300_000);
  const T = cartellaTemporanea('attriti-sporco-');
  const clone = join(T, 'clone');
  try {
    git(T, 'clone', '-q', '--shared', '--no-checkout', ROOT, clone);
    git(clone, 'checkout', '-q', git(ROOT, 'rev-parse', 'HEAD'));
    // La cartella di chi lavora: un file tracciato modificato e uno nuovo, niente commit.
    appendFileSync(join(clone, 'src', 'shared', 'patchNotes.js'), '\n// modifica in corso\n');
    writeFileSync(join(clone, 'appunti.txt'), 'bozza\n');
    expect(git(clone, 'status', '--porcelain')).not.toBe('');
    const r = await new Promise((ok) => execFile(process.execPath, ['--test', 'tests/unit/dueTesti.test.mjs'], { cwd: clone },
      (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
    expect(r.out).toMatch(/# pass [1-9]/);
    expect(r.out).toMatch(/# fail 0/);
    expect(r.code).toBe(0);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('dispatch: --ticket davanti a --record-verifier e --record-fixed consegna col biglietto dato', async () => {
  await conServer(async ({ ricevuti, port, casa }) => {
    const v = await lancia('dispatch.mjs', ['--ticket', B, '--record-verifier', 'fid-900', CRITICA], port, casa);
    expect(v.out).not.toMatch(/non riconosciuto/);
    expect(v.code).toBe(0);
    const critica = ricevuti.find((x) => x.url.includes('routineDeliver') && x.body.intent === 'verdict');
    expect(critica?.body.ticket).toBe(B);
  });
  await conServer(async ({ ricevuti, port, casa }) => {
    const f = await lancia('dispatch.mjs', ['--ticket', B, '--record-fixed', 'fid-900', REPORT, '--frase', 'Ora il pulsante salva.'], port, casa);
    expect(f.code).toBe(0);
    const c = ricevuti.find((x) => x.url.includes('routineDeliver') && x.body.intent === 'fixed');
    expect(c?.body.ticket).toBe(B);
    expect(String(c?.body.data?.report)).toMatch(/corretto il pulsante/);
    expect(c?.body.data?.userNote).toBe('Ora il pulsante salva.');
  });
  // L'ordine dell'aiuto resta buono.
  await conServer(async ({ ricevuti, port, casa }) => {
    const f = await lancia('dispatch.mjs', ['--record-fixed', 'fid-900', REPORT, '--ticket', B], port, casa);
    expect(f.code).toBe(0);
    expect(ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket).toBe(B);
  });
});

test('canale: deliver accetta --ticket, e senza biglietto esce 1 (non 3) senza chiamare il server', async () => {
  await conServer(async ({ ricevuti, port, casa }) => {
    const r = await lancia('routine-channel.mjs', ['deliver', 'status', '--status', 'revision_capability', '--notes', 'Report.', '--branch', 'worker/900', '--ticket', B], port, casa);
    expect(r.code).toBe(0);
    const c = ricevuti.find((x) => x.url.includes('routineDeliver'));
    expect(c?.body.ticket).toBe(B);
    expect(c?.body.intent).toBe('status');
    expect(c?.body.data?.ticket).toBeUndefined();
  });
  await conServer(async ({ ricevuti, port, casa }) => {
    const r = await lancia('routine-channel.mjs', ['deliver', 'fixed', '--notes', 'Report.', '--branch', 'worker/900'], port, casa);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/NESSUN BIGLIETTO/);
    expect(r.out).toMatch(/--ticket/);
    expect(ricevuti.length).toBe(0);
  });
});

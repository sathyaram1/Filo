// Giro 3 (verifica locale): le porte trovate al giro 2, ri-provate e chiuse. Strumenti veri contro un
// server finto, su depositi git usa-e-getta: Filo non si apre.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const C = 'ZZZZEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const D1 = '-bCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const D2 = '--CdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const CRITICA = 'Provato tutto: funziona come chiesto, niente da segnalare in nessuna parte del lavoro consegnato.';
const REL = ['--role', 'verifier', '--senza-push', '--senza-rapporto'];
const DEL = ['status', '--status', 'revision_capability', '--notes', 'Report.', '--branch', 'worker/900'];

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

function deposito() {
  const d = cartellaTemporanea('attriti-giro3-porte-');
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

async function lancia(script, argv) {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(b); } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, expiresAt: 'dopo' }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const casa = deposito();
  try {
    const r = await new Promise((ok) => execFile(process.execPath, [resolve(ROOT, 'scripts', script), ...argv], {
      cwd: casa,
      env: {
        ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_REPO_ROOT: casa,
        FILO_NO_BEAT: '1', FILO_DISPATCH_STATE_DIR: join(casa, 'stato'), FILO_ROUTINES_ENABLED: '1',
      },
    }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
    return { ...r, ricevuti };
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
}

const bigliettoA = (r, pezzo) => r.ricevuti.find((x) => x.url.includes(pezzo))?.body.ticket;

test('un biglietto che comincia con uno o due trattini vale davanti a rilascio, consegna e lettura del lavoro', async () => {
  for (const t of [D1, D2]) {
    const rel = await lancia('routine-channel.mjs', ['release', t, ...REL]);
    expect(rel.code).toBe(0);
    expect(bigliettoA(rel, 'routineRelease')).toBe(t);
    const del = await lancia('routine-channel.mjs', ['deliver', t, ...DEL]);
    expect(del.code).toBe(0);
    expect(bigliettoA(del, 'routineDeliver')).toBe(t);
    const work = await lancia('routine-channel.mjs', ['work', t]);
    expect(bigliettoA(work, 'routineWork')).toBe(t);
  }
});

test('un biglietto coi due trattini vale nelle registrazioni in ogni forma e nell\'avvio del giro', async () => {
  for (const argv of [['--record-verifier', 'fid-900', CRITICA, '--ticket', D2], ['--record-verifier', 'fid-900', CRITICA, `--ticket=${D2}`], ['--ticket', D2, '--record-verifier', 'fid-900', CRITICA]]) {
    const r = await lancia('dispatch.mjs', argv);
    expect(r.code).toBe(0);
    expect(bigliettoA(r, 'routineDeliver')).toBe(D2);
  }
  const avvio = await lancia('dispatch.mjs', ['--ticket', D2]);
  expect(bigliettoA(avvio, 'routineWork')).toBe(D2);
});

test('una regola sola per il biglietto a mano, nel canale e nelle registrazioni', async () => {
  // Due biglietti diversi a mano, anche col nome italiano: rifiuto, niente server.
  for (const [script, argv] of [
    ['routine-channel.mjs', ['deliver', ...DEL, '--ticket', B, '--ticket', C]],
    ['routine-channel.mjs', ['deliver', ...DEL, '--ticket', B, '--biglietto', C]],
    ['routine-channel.mjs', ['release', ...REL, '--ticket', B, '--ticket', C]],
    ['dispatch.mjs', ['--record-verifier', 'fid-900', CRITICA, '--ticket', B, '--ticket', C]],
    ['dispatch.mjs', ['--record-verifier', 'fid-900', CRITICA, '--ticket', B, '--biglietto', C]],
  ]) {
    const r = await lancia(script, argv);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Due biglietti diversi passati a mano/);
    expect(r.ricevuti).toHaveLength(0);
  }
  // Lo stesso biglietto due volte: vale in tutti e due.
  const d = await lancia('routine-channel.mjs', ['deliver', ...DEL, '--ticket', B, '--ticket', B]);
  expect(bigliettoA(d, 'routineDeliver')).toBe(B);
  const v = await lancia('dispatch.mjs', ['--record-verifier', 'fid-900', CRITICA, '--ticket', B, '--ticket', B]);
  expect(bigliettoA(v, 'routineDeliver')).toBe(B);
  // Un codice senza la forma di un biglietto, o vuoto: rifiuto col motivo, niente server.
  for (const [script, argv, motivo] of [
    ['routine-channel.mjs', ['deliver', ...DEL, '--ticket', 'abc'], /non ha la forma di un biglietto/],
    ['dispatch.mjs', ['--record-verifier', 'fid-900', CRITICA, '--ticket', 'abc'], /non ha la forma di un biglietto/],
    ['routine-channel.mjs', ['heartbeat', '--ticket='], /vuole il codice del biglietto/],
    ['dispatch.mjs', ['--record-verifier', 'fid-900', CRITICA, '--ticket='], /vuole il codice del biglietto/],
  ]) {
    const r = await lancia(script, argv);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(motivo);
    expect(r.ricevuti).toHaveLength(0);
  }
});

test('una parola lunga al posto dell\'intento, col biglietto a mano: intento non capito', async () => {
  const r = await lancia('routine-channel.mjs', ['deliver', 'revision_capability', '--notes', 'Report.', '--branch', 'worker/900', '--ticket', B]);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/Intento non capito: «revision_capability»/);
  expect(r.out).not.toMatch(/Due biglietti/);
  expect(r.ricevuti).toHaveLength(0);
});

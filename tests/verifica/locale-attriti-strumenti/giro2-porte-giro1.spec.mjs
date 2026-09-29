// Giro 2 (verifica locale): le porte trovate al giro 1, ri-provate e chiuse. Non aprono Filo: gli
// strumenti veri contro un server finto, su depositi git usa-e-getta.

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
const CRITICA = 'Provato tutto: funziona come chiesto, niente da segnalare in nessuna parte del lavoro consegnato.';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

function deposito() {
  const d = cartellaTemporanea('attriti-giro2-');
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

const RILASCIO = ['--role', 'verifier', '--senza-push', '--senza-rapporto'];

test('rilascio col solo biglietto a mano: rilascia quello', async () => {
  const r = await lancia('routine-channel.mjs', ['release', ...RILASCIO, '--ticket', B]);
  expect(r.code).toBe(0);
  expect(r.ricevuti.find((x) => x.url.includes('routineRelease'))?.body.ticket).toBe(B);
});

test('rilascio con un biglietto davanti e uno diverso a mano: rifiuta senza chiamare il server', async () => {
  const r = await lancia('routine-channel.mjs', ['release', B, ...RILASCIO, '--ticket', C]);
  expect(r.code).toBe(1);
  expect(r.ricevuti).toHaveLength(0);
});

test('battito: il biglietto a mano vale, e senza biglietto esce 1 senza chiamare il server', async () => {
  const conMano = await lancia('routine-channel.mjs', ['heartbeat', '--ticket', B]);
  expect(conMano.code).toBe(0);
  expect(conMano.ricevuti.find((x) => x.url.includes('routineHeartbeat'))?.body.ticket).toBe(B);
  const senza = await lancia('routine-channel.mjs', ['heartbeat']);
  expect(senza.code).toBe(1);
  expect(senza.out).toMatch(/NESSUN BIGLIETTO/);
  expect(senza.ricevuti).toHaveLength(0);
});

test('registrazioni: il biglietto col segno uguale vale davanti e dopo', async () => {
  for (const argv of [['--ticket=' + B, '--record-verifier', 'fid-900', CRITICA], ['--record-verifier', 'fid-900', CRITICA, '--ticket=' + B]]) {
    const r = await lancia('dispatch.mjs', argv);
    expect(r.code).toBe(0);
    expect(r.ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket).toBe(B);
  }
});

test('consegna con l\'intento storto: dice che l\'intento è storto, col biglietto a mano e senza', async () => {
  for (const argv of [['deliver', 'fixd', '--notes', 'Report.', '--ticket', B], ['deliver', 'fixd', '--notes', 'Report.']]) {
    const r = await lancia('routine-channel.mjs', argv);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Intento non capito: «fixd»/);
    expect(r.out).not.toMatch(/Due biglietti/);
    expect(r.ricevuti).toHaveLength(0);
  }
});

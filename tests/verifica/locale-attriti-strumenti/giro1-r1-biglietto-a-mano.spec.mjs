// Rilievo 1 del giro 1: il biglietto passato a mano con --ticket vale nella consegna ma non negli altri
// comandi degli strumenti delle routine (rilascio e battito lo accettano e lo ignorano; dispatch rifiuta
// la forma --ticket=<codice> che il canale accetta). Strumenti veri, server finto, deposito usa-e-getta.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const ALTRO = 'ZzCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdf';
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
  const d = cartellaTemporanea('attriti-biglietto-');
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
    timeout: 60_000,
  }, (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
}

async function conServer(fn) {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = deposito();
  try { return await fn({ ricevuti, port, casa }); } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
}

const RILASCIO = ['--role', 'verifier', '--senza-push', '--senza-rapporto'];

test('rilascio: --ticket al posto del biglietto davanti rilascia quel biglietto', async () => {
  await conServer(async ({ ricevuti, port, casa }) => {
    const r = await lancia('routine-channel.mjs', ['release', '--ticket', B, ...RILASCIO], port, casa);
    expect(r.out).not.toMatch(/^Uso:/m);
    expect(r.code).toBe(0);
    expect(ricevuti.find((x) => x.url.includes('routineRelease'))?.body.ticket).toBe(B);
  });
});

test('rilascio: due biglietti diversi (davanti e con --ticket) si rifiutano, come nella consegna', async () => {
  await conServer(async ({ ricevuti, port, casa }) => {
    const r = await lancia('routine-channel.mjs', ['release', B, '--ticket', ALTRO, ...RILASCIO], port, casa);
    expect(r.code).toBe(1);
    expect(ricevuti.filter((x) => x.url.includes('routineRelease'))).toHaveLength(0);
  });
});

test('battito: --ticket tiene vivo quel biglietto, non esce col codice del canale giù', async () => {
  await conServer(async ({ ricevuti, port, casa }) => {
    const r = await lancia('routine-channel.mjs', ['heartbeat', '--ticket', B], port, casa);
    expect(r.code).not.toBe(3);
    expect(ricevuti.find((x) => x.url.includes('routineHeartbeat'))?.body.ticket).toBe(B);
  });
});

test('dispatch: --ticket=<codice> vale come nel canale, davanti e dopo il --record-*', async () => {
  for (const argv of [
    [`--ticket=${B}`, '--record-fixed', 'fid-900', REPORT],
    ['--record-fixed', 'fid-900', REPORT, `--ticket=${B}`],
  ]) {
    await conServer(async ({ ricevuti, port, casa }) => {
      const r = await lancia('dispatch.mjs', argv, port, casa);
      expect(r.out).not.toMatch(/non riconosciuto|non capito/);
      expect(r.code).toBe(0);
      expect(ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket).toBe(B);
    });
  }
});

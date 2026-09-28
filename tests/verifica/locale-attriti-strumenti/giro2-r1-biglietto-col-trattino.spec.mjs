// Giro 2 (verifica locale), rilievo 1: un biglietto vero che comincia col trattino (il server li fa in
// base64url: uno su 64 comincia con «-», uno su 4096 con «--») viene preso per un'opzione scritta storta.
// Strumenti veri contro un server finto, su depositi git usa-e-getta.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TRATTINO = '-bCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const DUE_TRATTINI = '--CdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const REPORT = 'Report: corretto il pulsante che non salvava, lasciato stare il resto perché fuori dalla richiesta.';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

function deposito() {
  const d = cartellaTemporanea('attriti-giro2-r1-');
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

test('rilascio come da ricetta, con un biglietto che comincia col trattino: rilascia quello', async () => {
  const r = await lancia('routine-channel.mjs', ['release', TRATTINO, '--role', 'verifier', '--senza-push', '--senza-rapporto']);
  expect(r.out).not.toMatch(/Le opzioni si scrivono con due trattini/);
  expect(r.code).toBe(0);
  expect(r.ricevuti.find((x) => x.url.includes('routineRelease'))?.body.ticket).toBe(TRATTINO);
});

test('consegna col biglietto davanti che comincia col trattino: consegna con quello', async () => {
  const r = await lancia('routine-channel.mjs', ['deliver', TRATTINO, 'note', '--text', 'Una nota.']);
  expect(r.code).toBe(0);
  expect(r.ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket).toBe(TRATTINO);
});

test('un biglietto che comincia con due trattini passa almeno nella forma col segno uguale', async () => {
  const r = await lancia('dispatch.mjs', ['--record-fixed', 'fid-900', REPORT, `--ticket=${DUE_TRATTINI}`]);
  expect(r.code).toBe(0);
  expect(r.ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket).toBe(DUE_TRATTINI);
});

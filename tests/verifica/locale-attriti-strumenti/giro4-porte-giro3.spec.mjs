// Giro 4 (verifica locale): le porte trovate al giro 3, ri-provate e chiuse. Strumenti veri contro un
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
const REP = 'Report: corretto il pulsante che non salvava, lasciato stare il resto perché fuori dalla richiesta.';
const PUNTI = '- Corretto il pulsante che non salvava col titolo vuoto.\n- Lasciato stare il resto, che era già a posto e fuori dalla richiesta.';
const REL = ['--senza-push', '--senza-rapporto'];

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

function deposito() {
  const d = cartellaTemporanea('attriti-giro4-porte-');
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

test('col biglietto a mano una parola in più viene nominata, non presa per un secondo biglietto', async () => {
  for (const [argv, parola] of [
    [['deliver', 'fixed', REP, '--branch', 'worker/900', '--ticket', B], 'Report: corretto'],
    [['deliver', 'status', 'revision_capability', '--notes', REP, '--branch', 'worker/900', '--ticket', B], 'revision_capability'],
    [['deliver', 'feedback', 'Titolo del derivato', '--text', 'testo', '--ticket', B], 'Titolo del derivato'],
    [['release', 'verifier', ...REL, '--ticket', B], 'verifier'],
    [['heartbeat', 'loop', '--ticket', B], 'loop'],
  ]) {
    const r = await lancia('routine-channel.mjs', argv);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`Argomento non capito: "${parola}`);
    expect(r.out).not.toMatch(/Due biglietti/);
    expect(r.ricevuti).toHaveLength(0);
  }
});

test('lo stesso biglietto davanti, con uno spazio o un a capo, più quello a mano: vale uno solo', async () => {
  const d = await lancia('routine-channel.mjs', ['deliver', `${B} `, 'status', '--status', 'revision_capability', '--notes', REP, '--branch', 'worker/900', '--ticket', B]);
  expect(d.code).toBe(0);
  expect(d.ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket).toBe(B);
  const r = await lancia('routine-channel.mjs', ['release', `${B}\n`, '--role', 'verifier', ...REL, '--ticket', B]);
  expect(r.code).toBe(0);
  expect(r.ricevuti.find((x) => x.url.includes('routineRelease'))?.body.ticket).toBe(B);
});

test('una correzione col report a elenco puntato arriva intera, col biglietto davanti o dopo', async () => {
  for (const argv of [
    ['--record-fixed', 'fid-900', PUNTI, '--ticket', B],
    ['--ticket', B, '--record-fixed', 'fid-900', PUNTI, '--frase', '- Ora salva.'],
  ]) {
    const r = await lancia('dispatch.mjs', argv);
    expect(r.code).toBe(0);
    const c = r.ricevuti.find((x) => x.url.includes('routineDeliver'));
    expect(c?.body.ticket).toBe(B);
    expect(c?.body.data?.report).toBe(PUNTI);
  }
});

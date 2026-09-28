// Giro 2 (verifica locale), rilievo 2: il biglietto passato a mano segue ancora due regole, una nel canale
// e una nelle registrazioni, nei casi fuori dal comune (due biglietti a mano, valore storto o vuoto).
// Strumenti veri contro un server finto, su depositi git usa-e-getta.

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
const PROMEMORIA = 'PrOmEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const REPORT = 'Report: corretto il pulsante che non salvava, lasciato stare il resto perché fuori dalla richiesta.';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

function deposito(promemoria) {
  const d = cartellaTemporanea('attriti-giro2-r2-');
  git(d, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(d, 'config', k, v);
  writeFileSync(join(d, 'a.txt'), 'x\n');
  writeFileSync(join(d, '.gitignore'), 'stato/\n.claude/\n');
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'init');
  git(d, 'checkout', '-q', '-b', 'worker/900');
  mkdirSync(join(d, 'stato'));
  writeFileSync(join(d, 'stato', 'fid-900.json'), JSON.stringify({ id: 'fid-900', branch: 'worker/900', loopCount: 1, verifierVerdict: 'fail' }));
  if (promemoria) {
    mkdirSync(join(d, '.claude'), { recursive: true });
    writeFileSync(join(d, '.claude', 'routine-ticket.json'), JSON.stringify({ ticket: promemoria, since: new Date().toISOString() }));
  }
  return d;
}

async function lancia(script, argv, promemoria) {
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
  const casa = deposito(promemoria);
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

test('due biglietti diversi a mano: il canale rifiuta senza chiamare il server, come fanno le registrazioni', async () => {
  for (const argv of [
    ['deliver', 'note', '--text', 'Una nota.', '--ticket', B, '--ticket', C],
    ['deliver', 'note', '--text', 'Una nota.', '--ticket', B, '--biglietto', C],
    ['release', ...RILASCIO, '--ticket', B, '--ticket', C],
  ]) {
    const r = await lancia('routine-channel.mjs', argv);
    expect(r.ricevuti, argv.join(' ')).toHaveLength(0);
    expect(r.code, argv.join(' ')).toBe(1);
  }
  const d = await lancia('dispatch.mjs', ['--record-fixed', 'fid-900', REPORT, '--ticket', B, '--ticket', C]);
  expect(d.ricevuti).toHaveLength(0);
  expect(d.code).toBe(1);
});

test('lo stesso biglietto ripetuto a mano vale uguale nel canale e nelle registrazioni', async () => {
  const c = await lancia('routine-channel.mjs', ['deliver', 'note', '--text', 'Una nota.', '--ticket', B, '--ticket', B]);
  expect(c.code).toBe(0);
  const d = await lancia('dispatch.mjs', ['--ticket', B, '--record-fixed', 'fid-900', REPORT, '--ticket', B]);
  expect(d.out).not.toMatch(/Argomento non capito: --ticket/);
  expect(d.code).toBe(0);
  expect(d.ricevuti.find((x) => x.url.includes('routineDeliver'))?.body.ticket).toBe(B);
});

test('un valore che non è un biglietto, o vuoto, si ferma prima del server anche nel canale', async () => {
  const corto = await lancia('routine-channel.mjs', ['deliver', 'note', '--text', 'Una nota.', '--ticket', 'abc']);
  expect(corto.ricevuti).toHaveLength(0);
  expect(corto.code).toBe(1);
  // Col promemoria presente, un --ticket= vuoto non deve passare in silenzio al promemoria.
  const vuoto = await lancia('routine-channel.mjs', ['heartbeat', '--ticket='], PROMEMORIA);
  expect(vuoto.ricevuti).toHaveLength(0);
  expect(vuoto.code).toBe(1);
});

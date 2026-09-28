// Giro 3 (verifica locale), rilievo 2: una correzione col report che comincia con un elenco puntato
// viene respinta come argomento non capito. Strumenti veri contro un server finto: Filo non si apre.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const PUNTI = '- Corretto il pulsante che non salvava col titolo vuoto.\n- Lasciato stare il resto del lavoro, che era già a posto.';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

test('report a punti: la correzione arriva al server col report intero', async () => {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(b); } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const casa = cartellaTemporanea('attriti-giro3-punti-');
  try {
    git(casa, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(casa, 'config', k, v);
    writeFileSync(join(casa, 'a.txt'), 'x\n');
    writeFileSync(join(casa, '.gitignore'), 'stato/\n');
    git(casa, 'add', '-A'); git(casa, 'commit', '-qm', 'init');
    git(casa, 'checkout', '-q', '-b', 'worker/900');
    mkdirSync(join(casa, 'stato'));
    writeFileSync(join(casa, 'stato', 'fid-900.json'), JSON.stringify({ id: 'fid-900', branch: 'worker/900', loopCount: 1, verifierVerdict: 'fail' }));
    const r = await new Promise((ok) => execFile(process.execPath, [resolve(ROOT, 'scripts', 'dispatch.mjs'),
      '--record-fixed', 'fid-900', PUNTI, '--frase', 'Ora il pulsante salva.', '--ticket', B], {
      cwd: casa,
      env: {
        ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_REPO_ROOT: casa,
        FILO_NO_BEAT: '1', FILO_DISPATCH_STATE_DIR: join(casa, 'stato'), FILO_ROUTINES_ENABLED: '1',
      },
    }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
    expect(r.out).not.toMatch(/Argomento non capito/);
    expect(r.code).toBe(0);
    const c = ricevuti.find((x) => x.url.includes('routineDeliver'));
    expect(c?.body.data?.report).toBe(PUNTI);
    expect(c?.body.data?.userNote).toBe('Ora il pulsante salva.');
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
});

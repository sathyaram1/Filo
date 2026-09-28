// Giro 2 (verifica locale), rilievo 3: una consegna con l'intento sbagliato e lungo (per esempio lo stato
// «revision_capability» al posto dell'intento) e il biglietto a mano viene respinta come «due biglietti».
// Strumenti veri contro un server finto, su depositi git usa-e-getta.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const B = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

function git(cwd, ...a) { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); }

test('intento lungo e sbagliato col biglietto a mano: dice che l\'intento non è capito, non «due biglietti»', async () => {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    ricevuti.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const casa = cartellaTemporanea('attriti-giro2-r3-');
  try {
    git(casa, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['commit.gpgsign', 'false']]) git(casa, 'config', k, v);
    writeFileSync(join(casa, 'a.txt'), 'x\n');
    git(casa, 'add', '-A'); git(casa, 'commit', '-qm', 'init');
    const r = await new Promise((ok) => execFile(process.execPath, [resolve(ROOT, 'scripts', 'routine-channel.mjs'),
      'deliver', 'revision_capability', '--notes', 'Report.', '--branch', 'worker/900', '--ticket', B], {
      cwd: casa,
      env: { ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_REPO_ROOT: casa, FILO_NO_BEAT: '1' },
    }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
    expect(r.code).toBe(1);
    expect(ricevuti).toHaveLength(0);
    expect(r.out).not.toMatch(/Due biglietti/);
    expect(r.out).toMatch(/verdict, fixed, secaudit, status, note, feedback/);
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
});

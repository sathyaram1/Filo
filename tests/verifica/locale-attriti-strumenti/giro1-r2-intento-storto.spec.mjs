// Rilievo 2 del giro 1: una consegna col biglietto passato a mano e l'intento scritto storto viene
// respinta come «due biglietti diversi», e chi consegna cerca un problema di biglietto che non c'è.
// Strumento vero, server finto, deposito usa-e-getta.

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

test('intento sconosciuto con --ticket: il messaggio nomina l\'intento, non due biglietti', async () => {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    ricevuti.push(req.url);
    req.resume();
    req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const casa = cartellaTemporanea('attriti-intento-');
  try {
    git(casa, 'init', '-q', '-b', 'worker/900');
    for (const [k, v] of [['user.email', 'v@v'], ['user.name', 'v'], ['commit.gpgsign', 'false']]) git(casa, 'config', k, v);
    writeFileSync(join(casa, 'a.txt'), 'x\n');
    git(casa, 'add', '-A'); git(casa, 'commit', '-qm', 'init');
    const r = await new Promise((ok) => execFile(process.execPath,
      [resolve(ROOT, 'scripts', 'routine-channel.mjs'), 'deliver', 'fixd', '--ticket', B, '--notes', 'Report.'], {
        env: { ...process.env, FILO_ROUTINE_TICKET: '', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_REPO_ROOT: casa, FILO_NO_BEAT: '1' },
        timeout: 60_000,
      }, (err, so, se) => ok({ code: err ? (err.code ?? 1) : 0, out: `${so}${se}` })));
    expect(r.code).toBe(1);
    expect(ricevuti).toHaveLength(0);
    expect(r.out).toMatch(/fixd/);
    expect(r.out).not.toMatch(/[Dd]ue biglietti/);
  } finally { srv.close(); rmSync(casa, { recursive: true, force: true }); }
});

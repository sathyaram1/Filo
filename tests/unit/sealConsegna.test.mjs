// La consegna via canale SIGILLA il punto fermo (#507) — prova del collante.
//
// La logica del sigillo vive in branch-integrity (sealCurrentWork, coi suoi
// test). Qui si prova la strada INTERA che l'incidente ha percorso: il worker
// del primo passaggio consegna con `routine-channel.mjs deliver status`, e
// senza il sigillo il posizionamento successivo nello stesso clone riportava
// il ramo alla base parcheggiando la consegna su discarded/ (#502, #495).
// Rosso senza il fix: il punto fermo resterebbe alla base.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fintoServer() {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

test('deliver status (primo passaggio) lascia il punto fermo sulla consegna', async () => {
  const { srv, port } = await fintoServer();
  const casa = mkdtempSync(resolve(tmpdir(), 'filo-seal-'));
  const g = (args) => execFileSync('git', args, { cwd: casa, encoding: 'utf8' }).trim();
  try {
    g(['init', '-q', '-b', 'main']);
    g(['config', 'user.email', 't@t']);
    g(['config', 'user.name', 't']);
    writeFileSync(resolve(casa, 'base.txt'), 'base\n', 'utf8');
    g(['add', '-A']); g(['commit', '-qm', 'init']);
    g(['checkout', '-q', '-b', 'worker/900']);
    const base = g(['rev-parse', 'HEAD']);

    // Come positionOnBranch: stato col punto fermo alla base + identità attesa.
    const { writeBranchState, withCheckpoint, writeExpectation, readBranchState, lastCheckpoint, ensureSessionExcludes } =
      await import('../../scripts/lib/branch-integrity.mjs');
    ensureSessionExcludes(casa);
    writeBranchState(casa, withCheckpoint({ id: 'fid-900', branch: 'worker/900' }, base, 'new-work:checkout'));
    writeExpectation(casa, { branch: 'worker/900', id: 'fid-900' });

    // Il lavoro.
    writeFileSync(resolve(casa, 'lavoro.txt'), 'fatto\n', 'utf8');
    g(['add', '-A']); g(['commit', '-qm', 'lavoro']);
    const consegna = g(['rev-parse', 'HEAD']);

    const r = await new Promise((done) => {
      execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'),
        'deliver', 'biglietto-di-prova', 'status',
        '--status', 'revision_capability', '--notes', 'report', '--branch', 'worker/900',
      ], {
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          FILO_REPO_ROOT: casa,
          FILO_NO_BEAT: '1',
        },
      }, (err, so, se) => done({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
    });
    assert.equal(r.code, 0, `consegna accettata dal server finto (stderr: ${r.se})`);
    assert.equal(lastCheckpoint(readBranchState(casa, 'fid-900')), consegna,
      'il punto fermo deve essere la consegna, non la base: senza, il giro dopo la scarta (#507)');
  } finally {
    srv.close();
    try { rmSync(casa, { recursive: true, force: true }); } catch (_) { /* Windows EBUSY: riprova sotto */ }
  }
});

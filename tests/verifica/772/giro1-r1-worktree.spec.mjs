// #772 giro 1, rilievo 1: la consegna dal canale guarda il ramo della cartella di dispatch, non di quella da cui parte.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const { writeBranchState, withCheckpoint, writeExpectation, ensureSessionExcludes } = await import('../../../scripts/lib/branch-integrity.mjs');
const CANALE = fileURLToPath(new URL('../../../scripts/routine-channel.mjs', import.meta.url));
const ASSEGNATO = 'worker/772-x';
const ID = 'fid-772';

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { let j = {}; try { j = JSON.parse(body || '{}'); } catch (_) {} ricevuti.push({ url: String(req.url), body: j });
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, id: ID, num: '#772' })); });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}
function deposito() {
  const base = cartellaTemporanea('filo-772v-');
  const origin = resolve(base, 'origin.git'); const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  const g = (args, cwd = work) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g(['init', '--bare', '-q', '--initial-branch=main'], origin);
  g(['init', '-q', '--initial-branch=main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  g(['remote', 'add', 'origin', origin]);
  writeFileSync(resolve(work, 'a.txt'), 'base\n'); writeFileSync(resolve(work, '.gitignore'), '.claude/worktrees/\n'); g(['add', '-A']); g(['commit', '-qm', 'base']); g(['push', '-q', 'origin', 'main']);
  g(['remote', 'set-head', 'origin', 'main']);
  g(['checkout', '-q', '-b', ASSEGNATO]);
  ensureSessionExcludes(work);
  writeBranchState(work, withCheckpoint({ id: ID, branch: ASSEGNATO }, g(['rev-parse', 'HEAD']), 'new-work:checkout'));
  writeExpectation(work, { branch: ASSEGNATO, id: ID });
  return { base, work, g };
}
const lancia = (work, port, cwd, args) => new Promise((r) => execFile(process.execPath, [CANALE, 'deliver', 'b', ...args], {
  env: { ...process.env, FILO_REPO_ROOT: work, FILO_TOOLS_ROOT: work, FILO_NO_BEAT: '1', FILO_ROUTINE_API: `http://127.0.0.1:${port}` }, cwd },
  (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so), se: String(se) })));

test('r1 il lavoro committato in un worktree su un altro ramo non si consegna da lì col ramo e lo sha della cartella di dispatch', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const { base, work, g } = deposito();
  try {
    const wt = resolve(work, '.claude', 'worktrees', 'altro');
    g(['worktree', 'add', '-q', wt, '-b', 'claude/altro']);
    writeFileSync(resolve(wt, 'lavoro.txt'), 'fatto\n'); g(['add', '-A'], wt); g(['commit', '-qm', 'lavoro'], wt);
    const r = await lancia(work, port, wt, ['status', '--status', 'revision_capability', '--notes', 'x', '--frase', 'y']);
    expect(r.code, r.se).not.toBe(0);
    expect(ricevuti.length).toBe(0);
  } finally { srv.close(); togliCartella(base); }
});

// #2516 giro 2: una fermata consegnata con la cartella su una HEAD staccata (un rebase lasciato a metà) non deve
// arrivare al server mentre i commit fatti stanno solo nella cartella: chi riparte non li ritroverebbe.
import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { writeTicket } from '../../../scripts/lib/routine-ticket.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RAMO = 'worker/fid-2516-20261107T120000Z';
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function commit(cwd, file, body) {
  writeFileSync(resolve(cwd, file), body, 'utf8');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', `add ${file}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

async function fermata(casa, biglietto) {
  const consegne = [];
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      if (req.url.endsWith('/routineDeliver')) consegne.push(JSON.parse(corpo || '{}'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const esito = await new Promise((risolvi) => {
    const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), 'deliver', biglietto, 'status',
      '--status', 'design', '--reason', 'locale', '--notes', 'Serve il server. A1-A2 fatte sul ramo.'], {
      cwd: casa,
      env: { ...process.env, FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, FILO_REPO_ROOT: casa, FILO_TOOLS_ROOT: casa, FILO_ROUTINE_TICKET: '' },
    });
    let se = '';
    p.stderr.on('data', (c) => { se += c; });
    p.on('close', (code) => risolvi({ code, se }));
  });
  srv.close();
  return { ...esito, consegne };
}

test('r1 la fermata da una HEAD staccata non parte finché il lavoro fatto non è su origin', async () => {
  const biglietto = 'f'.repeat(43);
  const base = cartellaTemporanea('verifica-2516-staccata-');
  try {
    const origin = resolve(base, 'origin.git');
    const casa = resolve(base, 'casa');
    mkdirSync(casa, { recursive: true });
    git(base, 'init', '-q', '--bare', '-b', 'main', origin);
    git(casa, 'init', '-q', '-b', 'main');
    cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
    writeFileSync(resolve(casa, '.gitignore'),
      '.claude/routine-ticket.json\n.claude/routine-beat.json\n.claude/routine-state/\n.claude/branch-expect.json\n.claude/routine-role.json\n', 'utf8');
    commit(casa, 'segnaposto.txt', 'x\n');
    git(casa, 'remote', 'add', 'origin', origin);
    git(casa, 'push', '-q', '-u', 'origin', 'main');
    git(casa, 'checkout', '-q', '-b', RAMO);
    commit(casa, 'parte-a1.js', 'A1\n');
    git(casa, 'push', '-q', 'origin', `${RAMO}:refs/heads/${RAMO}`);
    git(casa, 'checkout', '-q', '--detach');
    const punta = commit(casa, 'parte-a2.js', 'A2\n');
    writeTicket(casa, biglietto);

    const r = await fermata(casa, biglietto);
    const suOrigin = git(origin, 'rev-parse', `refs/heads/${RAMO}`);
    // Successo per chi riparte: o la fermata è rifiutata, o la parte A2 è sul ramo che il server ha legato.
    expect(r.consegne.length === 0 || suOrigin === punta, `fermata consegnata (uscita ${r.code}) con su origin ${suOrigin.slice(0, 9)} e la parte A2 solo nella cartella a ${punta.slice(0, 9)}:\n${r.se}`).toBe(true);
  } finally { togliCartella(base); }
});

// Prove del giro 4 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 3: il rilascio del biglietto quando la copia di lavoro è a metà di un
// rebase o di una fusione fermi su un conflitto. Il rilascio committa da sé
// quello che è rimasto fuori dai commit (giro 2): qui si guarda che NON lo
// faccia in quel momento — metterebbe in commit i segni di conflitto e li
// spedirebbe — e che il server non venga chiamato.

import { test, expect } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CANALE = join(ROOT, 'scripts', 'routine-channel.mjs');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitTenta(cwd, ...args) {
  return spawnSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
}

/** origin nudo, main con «base», un ramo di lavoro spedito, poi main che diverge sugli stessi file. */
function scenario(nome) {
  const base = cartellaTemporanea(`giro4-rilascio-${nome}-`);
  const origin = join(base, 'origin.git');
  const lavoro = join(base, 'lavoro');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'clone', '-q', origin, lavoro);
  git(lavoro, 'config', 'core.autocrlf', 'false');
  git(lavoro, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(lavoro, 'a.txt'), 'base\n');
  writeFileSync(join(lavoro, 'b.txt'), 'base\n');
  git(lavoro, 'add', '-A');
  git(lavoro, 'commit', '-q', '-m', 'base');
  git(lavoro, 'push', '-q', '-u', 'origin', 'main');
  git(lavoro, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(lavoro, 'a.txt'), 'mio\n');
  writeFileSync(join(lavoro, 'b.txt'), 'mio\n');
  git(lavoro, 'commit', '-q', '-am', 'mio');
  git(lavoro, 'push', '-q', '-u', 'origin', 'claude/prova');
  git(lavoro, 'checkout', '-q', 'main');
  writeFileSync(join(lavoro, 'a.txt'), 'loro\n');
  writeFileSync(join(lavoro, 'b.txt'), 'loro\n');
  git(lavoro, 'commit', '-q', '-am', 'loro');
  git(lavoro, 'push', '-q', 'origin', 'main');
  git(lavoro, 'checkout', '-q', 'claude/prova');
  const transcript = join(base, 'sessione.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', sessionId: 's', message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 }, content: [] } }) + '\n');
  return { base, origin, lavoro, transcript };
}

function canaleFinto() {
  const chiamate = [];
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      chiamate.push({ path: req.url, payload: JSON.parse(corpo || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, chiamate, url: `http://127.0.0.1:${server.address().port}` })));
}

function rilascia(s, url) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CANALE, 'release', 'biglietto-di-prova-1234567890', '--role', 'resolver'], {
      cwd: s.lavoro, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FILO_ROUTINE_API: url, FILO_REPO_ROOT: s.lavoro, FILO_TRANSCRIPT: s.transcript, FILO_ROUTINE: '1' },
    });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const t = setTimeout(() => { p.kill(); }, 45000);
    p.on('close', (status) => { clearTimeout(t); ok({ status, stdout, stderr }); });
  });
}

test.describe('rilascio del biglietto con un rebase o una fusione a metà', () => {
  test('rebase fermo su un conflitto: il rilascio non committa i segni di conflitto, non chiama il server ed esce diverso da zero', async () => {
    const s = scenario('rebase');
    const r = gitTenta(s.lavoro, 'rebase', 'main');
    expect(r.status).not.toBe(0);
    expect(readFileSync(join(s.lavoro, 'a.txt'), 'utf8')).toContain('<<<<<<<');
    // L'agente risolve UN file (come farebbe con un Edit) e, distratto, rilascia.
    writeFileSync(join(s.lavoro, 'a.txt'), 'risolto\n');
    const primaHead = git(s.lavoro, 'rev-parse', 'HEAD');
    const c = await canaleFinto();
    try {
      const esito = await rilascia(s, c.url);
      expect(esito.status).not.toBe(0);
      expect(esito.stderr).toMatch(/un rebase/i);
      expect(esito.stderr).toMatch(/a met[àa]/i);
      expect(c.chiamate.length).toBe(0);
      // Niente commit nuovo, niente segni di conflitto nella storia.
      expect(git(s.lavoro, 'rev-parse', 'HEAD')).toBe(primaHead);
      expect(git(s.lavoro, 'show', 'HEAD:b.txt')).not.toContain('<<<<<<<');
      // origin è rimasto a «mio».
      expect(git(s.origin, 'show', 'claude/prova:a.txt')).toBe('mio');
    } finally {
      c.server.close();
    }
  });

  test('fusione ferma su un conflitto: stesso rifiuto, e su origin non arriva niente', async () => {
    const s = scenario('merge');
    const r = gitTenta(s.lavoro, 'merge', 'main');
    expect(r.status).not.toBe(0);
    writeFileSync(join(s.lavoro, 'a.txt'), 'risolto\n');
    const primaHead = git(s.lavoro, 'rev-parse', 'HEAD');
    const c = await canaleFinto();
    try {
      const esito = await rilascia(s, c.url);
      expect(esito.status).not.toBe(0);
      expect(esito.stderr).toMatch(/una fusione/i);
      expect(c.chiamate.length).toBe(0);
      expect(git(s.lavoro, 'rev-parse', 'HEAD')).toBe(primaHead);
      expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(primaHead);
    } finally {
      c.server.close();
    }
  });

  test('rebase con tutti i file risolti e messi in scena ma non ancora continuato: il rilascio si ferma lo stesso', async () => {
    const s = scenario('staged');
    gitTenta(s.lavoro, 'rebase', 'main');
    writeFileSync(join(s.lavoro, 'a.txt'), 'risolto\n');
    writeFileSync(join(s.lavoro, 'b.txt'), 'risolto\n');
    git(s.lavoro, 'add', '-A');
    const c = await canaleFinto();
    try {
      const esito = await rilascia(s, c.url);
      expect(esito.status).not.toBe(0);
      expect(esito.stderr).toMatch(/un rebase/i);
      expect(c.chiamate.length).toBe(0);
    } finally {
      c.server.close();
    }
  });

  test('finito il rebase (git rebase --continue), il rilascio spedisce la storia riscritta e chiama il server', async () => {
    const s = scenario('finito');
    gitTenta(s.lavoro, 'rebase', 'main');
    writeFileSync(join(s.lavoro, 'a.txt'), 'risolto\n');
    writeFileSync(join(s.lavoro, 'b.txt'), 'risolto\n');
    git(s.lavoro, 'add', '-A');
    const cont = spawnSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.editor=true', 'rebase', '--continue'], { cwd: s.lavoro, encoding: 'utf8' });
    expect(cont.status).toBe(0);
    const head = git(s.lavoro, 'rev-parse', 'HEAD');
    const c = await canaleFinto();
    try {
      const esito = await rilascia(s, c.url);
      expect(esito.status).toBe(0);
      expect(esito.stdout).toMatch(/OK: biglietto rilasciato/);
      expect(c.chiamate.length).toBe(1);
      expect(c.chiamate[0].path).toMatch(/routineRelease/);
      expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(head);
      expect(git(s.origin, 'show', 'claude/prova:a.txt')).toBe('risolto');
    } finally {
      c.server.close();
    }
  });
});

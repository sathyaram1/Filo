// #2046 giro 1, rilievo 1: l'originale chiuso dall'approvazione dell'owner («finish: worker/<id> via server») ha una
// fusione che non cita il suo numero (i commit del ramo sono «auto: <file>»), come #1776 e #1930 del caso segnalato.
// Lo strumento deve lasciar arrivare al server il doppione di un originale così. Server finto, come negli unit.
import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fintoServer() {
  const ricevuti = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = body ? JSON.parse(body) : {}; } catch (_) {}
      ricevuti.push({ url: req.url, body: j });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, ricevuti, port: srv.address().port })));
}

const esegui = (argv, env) => new Promise((r) => {
  execFile(process.execPath, [resolve(REPO, 'scripts', 'routine-channel.mjs'), ...argv], { env: { ...process.env, FILO_NO_BEAT: '1', ...env } },
    (err, so, se) => r({ code: err ? (err.code ?? 1) : 0, so: String(so || ''), se: String(se || '') }));
});

test('r1 il doppione di un originale fuso con l\'approvazione dell\'owner arriva al server', async () => {
  const { srv, ricevuti, port } = await fintoServer();
  const casa = cartellaTemporanea('verifica-2046-');
  try {
    git(casa, ['init', '-q', '-b', 'main']);
    git(casa, ['config', 'user.email', 't@t']); git(casa, ['config', 'user.name', 't']); git(casa, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(casa, '.gitignore'), 'stato/\n.claude/\n');
    writeFileSync(join(casa, 'a.js'), 'uno\n');
    git(casa, ['add', '-A']); git(casa, ['commit', '-qm', 'inizio']);
    const ramo = 'worker/UB2K0LIM5U7ejgZIjAHS-20261030T031120Z';
    git(casa, ['checkout', '-qb', ramo]);
    writeFileSync(join(casa, 'a.js'), 'due\n');
    git(casa, ['commit', '-qam', 'auto: a.js']);
    git(casa, ['checkout', '-q', 'main']);
    git(casa, ['merge', '-q', '--no-ff', ramo, '-m', `finish: ${ramo} via server (approvazione dell’owner)`]);
    const fusione = git(casa, ['rev-parse', 'HEAD']);
    git(casa, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(casa, ['checkout', '-qb', 'worker/KVAdENjAAJ2P7p236UOY']);
    const r = await esegui(['deliver', 'b'.repeat(43), 'status', '--status', 'done', '--reason', 'gia_risolto',
      '--fusione', fusione, '--doppione-di', '1776',
      '--notes', 'Stessa richiesta di #1776, chiusa da quella fusione.', '--frase', 'La cosa chiesta adesso funziona.'],
    { FILO_ROUTINE_API: `http://127.0.0.1:${port}`, FILO_REPO_ROOT: casa });
    expect(r.se).not.toMatch(/non porta nessun commit che citi/);
    expect(r.code).toBe(0);
    const d = ricevuti.filter((x) => x.url.includes('routineDeliver')).pop();
    expect(d && d.body.data.doppioneDi).toBe('1776');
    expect(d.body.data.fusione).toBe(fusione);
  } finally {
    srv.close();
    togliCartella(casa);
  }
});

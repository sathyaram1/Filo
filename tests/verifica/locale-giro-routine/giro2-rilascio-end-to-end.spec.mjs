// Prove del giro 2 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punti 3 e 5, dalla riga di comando VERA del rilascio: un repo costruito qui,
// un server finto che risponde al posto del canale (FILO_ROUTINE_API) e un
// transcript scritto a mano (FILO_TRANSCRIPT). Si guarda quello che arriva al
// server: il ramo su origin prima della chiamata, il rapporto allegato col
// ruolo, e le ritentate quando il server rifiuta il rapporto.

import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CANALE = join(ROOT, 'scripts', 'routine-channel.mjs');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function scenario(nome) {
  const base = cartellaTemporanea(`giro2-rilascio-${nome}-`);
  const origin = join(base, 'origin.git');
  const lavoro = join(base, 'lavoro');
  const altro = join(base, 'altro');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'clone', '-q', origin, lavoro);
  git(lavoro, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(lavoro, 'a.txt'), 'uno\n');
  git(lavoro, 'add', '-A');
  git(lavoro, 'commit', '-q', '-m', 'primo');
  git(lavoro, 'push', '-q', '-u', 'origin', 'claude/prova');
  git(base, 'clone', '-q', '-b', 'claude/prova', origin, altro);
  const transcript = join(base, 'sessione.jsonl');
  const uso = { input_tokens: 10, cache_creation_input_tokens: 30000, cache_read_input_tokens: 0, output_tokens: 40 };
  writeFileSync(transcript, [
    { type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', sessionId: 'sess-e2e', message: { id: 'm1', model: 'claude-opus-5', usage: uso, content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } },
    { type: 'user', timestamp: '2026-09-16T10:00:30.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    { type: 'assistant', timestamp: '2026-09-16T10:01:00.000Z', sessionId: 'sess-e2e', message: { id: 'm2', model: 'claude-opus-5', usage: uso, content: [{ type: 'text', text: 'fine' }] } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { base, origin, lavoro, altro, transcript };
}

/** Un canale finto: registra ogni chiamata e risponde con quello che gli si dice. */
function canaleFinto(risposte) {
  const chiamate = [];
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(corpo || '{}'); } catch (_) { /* resta vuoto */ }
      chiamate.push({ path: req.url, payload });
      const r = risposte[Math.min(chiamate.length - 1, risposte.length - 1)];
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, chiamate, url: `http://127.0.0.1:${server.address().port}` })));
}

/** Il rilascio, in un processo figlio ASINCRONO: il server finto vive in questo processo e deve poter rispondere. */
function rilascia(s, url, extra = []) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CANALE, 'release', 'biglietto-di-prova-1234567890', '--role', 'verifier', ...extra], {
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

test.describe('rilascio del biglietto, dalla riga di comando vera', () => {
  test('un file nato da una shell arriva su origin PRIMA della chiamata, e il rapporto viaggia col ruolo', async () => {
    const s = scenario('ok');
    writeFileSync(join(s.lavoro, 'nato-da-shell.txt'), 'quattro\n');
    const c = await canaleFinto([{ status: 200, body: { ok: true } }]);
    try {
      const r = await rilascia(s, c.url);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/OK: biglietto rilasciato/);
      expect(r.stderr).toMatch(/committate 1 modifiche rimaste fuori dai commit: nato-da-shell\.txt/);
      expect(r.stderr).toMatch(/ramo 'claude\/prova' spedito su origin/);
      expect(git(s.origin, 'ls-tree', '--name-only', 'claude/prova').split('\n')).toContain('nato-da-shell.txt');
      expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(git(s.lavoro, 'rev-parse', 'HEAD'));
      // Al server: una sola chiamata, col biglietto e il rapporto firmato.
      expect(c.chiamate).toHaveLength(1);
      expect(c.chiamate[0].path).toBe('/routineRelease');
      const p = c.chiamate[0].payload;
      expect(p.ticket).toBe('biglietto-di-prova-1234567890');
      expect(p.fault).toBeUndefined();
      expect(p.report.role).toBe('verifier');
      expect(p.report.ticket).toBe('biglietto-di-prova-1234567890');
      expect(p.report.sessionId).toBe('sess-e2e');
      expect(p.report.turns).toBe(2);
      expect(p.report.tools.byName).toEqual({ Bash: 1 });
      expect(p.report.costUsd).toBeGreaterThan(0);
      expect(p.report.durationS).toBe(60);
    } finally { c.server.close(); }
  });

  test('col guasto dichiarato: il guasto arriva al server insieme al rapporto', async () => {
    const s = scenario('guasto');
    const c = await canaleFinto([{ status: 200, body: { ok: true } }]);
    try {
      const r = await rilascia(s, c.url, ['--guasto', 'npm install non riesce']);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/guasto dichiarato/);
      expect(c.chiamate[0].payload.fault).toBe('npm install non riesce');
      expect(c.chiamate[0].payload.report.role).toBe('verifier');
    } finally { c.server.close(); }
  });

  test('rapporto troppo grande per il server: si ritenta senza l\'elenco degli strumenti, e lo si dice', async () => {
    const s = scenario('413');
    const c = await canaleFinto([
      { status: 413, body: { ok: false, reason: 'report_too_big', bytes: 99999, max: 8192 } },
      { status: 200, body: { ok: true } },
    ]);
    try {
      const r = await rilascia(s, c.url);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/OK: biglietto rilasciato/);
      expect(r.stderr).toMatch(/rapporto troppo grande \(99999 byte, massimo 8192\)/);
      expect(c.chiamate).toHaveLength(2);
      expect(c.chiamate[0].payload.report.tools.byName).toEqual({ Bash: 1 });
      expect(c.chiamate[1].payload.report.tools.byName).toBeUndefined();
      expect(c.chiamate[1].payload.report.notes).toBeUndefined();
      expect(c.chiamate[1].payload.report.turns).toBe(2);
    } finally { c.server.close(); }
  });

  test('rapporto che il server non capisce: rilasciato SENZA rapporto, e lo si dice col motivo del server', async () => {
    // L'avviso dice «report_malformed» ma perde il dettaglio che il server ha
    // mandato (qui «campo x»): l'avviso legge la risposta della SECONDA
    // chiamata, quella senza rapporto, non della prima. Rilievo del giro 2,
    // situazione rara (il server che rifiuta un rapporto): livello 0.
    test.fail(true, 'rilievo del giro 2: il dettaglio del rifiuto del server non compare nell’avviso');
    const s = scenario('400');
    const c = await canaleFinto([
      { status: 400, body: { ok: false, reason: 'report_malformed', detail: 'campo x' } },
      { status: 200, body: { ok: true } },
    ]);
    try {
      const r = await rilascia(s, c.url);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toMatch(/report_malformed: campo x/);
      expect(c.chiamate).toHaveLength(2);
      expect(c.chiamate[1].payload.report).toBeUndefined();
    } finally { c.server.close(); }
  });

  test('se il push non riesce il server NON viene chiamato e il comando esce diverso da zero', async () => {
    const s = scenario('push-ko');
    writeFileSync(join(s.altro, 'c.txt'), 'tre\n');
    git(s.altro, 'add', '-A');
    git(s.altro, 'commit', '-q', '-m', 'di un altro');
    git(s.altro, 'push', '-q', 'origin', 'claude/prova');
    const diAltri = git(s.altro, 'rev-parse', 'HEAD');
    git(s.lavoro, 'commit', '-q', '--amend', '-m', 'primo, riscritto');
    const c = await canaleFinto([{ status: 200, body: { ok: true } }]);
    try {
      const r = await rilascia(s, c.url);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/NON è arrivato su origin/);
      expect(r.stderr).toMatch(/Non ho rilasciato niente/);
      expect(c.chiamate).toHaveLength(0);
      expect(git(s.origin, 'rev-parse', 'claude/prova')).toBe(diAltri);
    } finally { c.server.close(); }
  });

  test('senza transcript il rilascio va lo stesso, col rapporto minimo e la nota', async () => {
    const s = scenario('senza-transcript');
    s.transcript = join(s.base, 'non-esiste.jsonl');
    const c = await canaleFinto([{ status: 200, body: { ok: true } }]);
    try {
      const r = await rilascia(s, c.url);
      expect(r.status, r.stderr).toBe(0);
      const rep = c.chiamate[0].payload.report;
      expect(rep.turns).toBe(0);
      expect(rep.notes.join(' ')).toMatch(/assente/);
    } finally { c.server.close(); }
  });
});

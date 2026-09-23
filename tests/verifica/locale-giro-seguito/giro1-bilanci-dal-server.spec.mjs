// Prove del giro 1 (verifica locale) sul lavoro «seguito del giro»,
// punto A: i bilanci del giro di verifica locale (uno per livello, cap3…cap0)
// si leggono dal server, con l'identità dell'owner, e nel codice pubblico non
// c'è più un numero di ripiego. Senza token, senza documento, senza uno dei
// numeri: errore evidente e stop, niente toccato.
//
// Lo strumento si prova COME LO USA L'OWNER: il comando vero (`status`,
// `critica`) lanciato in un sotto-processo, con un server finto in ascolto in
// locale al posto di Firestore (FILO_ROUTINE_CONFIG_URL) e un token già
// coniato (FILO_ADMIN_ID_TOKEN), su un repo temporaneo (FILO_REPO_ROOT) così
// che lo stato della verifica vera di questo ramo non venga toccato.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { leggiBilanciDalServer, withCritique, readState, SENZA_TOKEN_MSG } from '../../../scripts/verify-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'verify-local.mjs');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@prova', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Un repo temporaneo su un ramo di lavoro, con lo stato della verifica ignorato da git (com'è nel repo vero). */
function repoTemporaneo() {
  const base = cartellaTemporanea('giro1-bilanci-');
  const repo = join(base, 'repo');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', 'claude/prova');
  writeFileSync(join(repo, '.gitignore'), '.claude/\n');
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  mkdirSync(join(repo, '.claude'), { recursive: true });
  return repo;
}

/** Un Firestore finto: risponde secondo `stato.risposta`, e conta le richieste. */
async function serverFinto() {
  const stato = { risposta: { status: 200, body: {} }, richieste: [] };
  const srv = createServer((req, res) => {
    stato.richieste.push({ url: req.url, auth: req.headers.authorization || '' });
    res.writeHead(stato.risposta.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stato.risposta.body));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${srv.address().port}/v1/projects/finto/databases/(default)/documents/config/routines`;
  return { stato, url, chiudi: () => new Promise((ok) => srv.close(ok)) };
}

const doc = (cap2, cap1, cap0) => ({
  fields: {
    ...(cap2 !== undefined ? { cap2 } : {}),
    ...(cap1 !== undefined ? { cap1 } : {}),
    ...(cap0 !== undefined ? { cap0 } : {}),
  },
});
const int = (n) => ({ integerValue: String(n) });

/** Il comando in un sotto-processo, ASINCRONO: il server finto vive in questo stesso processo e deve poter rispondere. */
function lancia(repo, url, ...args) {
  const env = { ...process.env, FILO_REPO_ROOT: repo, FILO_ROUTINE_CONFIG_URL: url, FILO_ADMIN_ID_TOKEN: 'token-finto-di-prova' };
  delete env.FILO_ADMIN_REFRESH_TOKEN;
  return new Promise((ok) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { cwd: repo, env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (status) => ok({ status, stdout, stderr }));
  });
}

test.describe('bilanci del giro — dal server, con l\'identità dell\'owner, nessun ripiego', () => {
  test('senza token la lettura si ferma e dice dove si mette il token: nessun numero al suo posto', async () => {
    await expect(leggiBilanciDalServer({ env: {}, trovaRefresh: () => null })).rejects.toThrow(/FILO_ADMIN_REFRESH_TOKEN/);
    await expect(leggiBilanciDalServer({ env: {}, trovaRefresh: () => null })).rejects.toThrow(/admin-login/);
    expect(SENZA_TOKEN_MSG).toMatch(/non c'è un default/i);
    // Un indirizzo del server passato a mano non è una scorciatoia attorno al token.
    await expect(leggiBilanciDalServer({ env: { FILO_ROUTINE_CONFIG_URL: 'http://127.0.0.1:1/x' }, trovaRefresh: () => null }))
      .rejects.toThrow(/FILO_ADMIN_REFRESH_TOKEN/);
  });

  test('`status`: documento assente, numero mancante, numero non numerico, server che rifiuta, rete giù → esce con errore e lo dice; con i tre numeri (anche 0) li stampa', async () => {
    const repo = repoTemporaneo();
    const s = await serverFinto();
    try {
      // Documento assente sul server.
      s.stato.risposta = { status: 404, body: { error: { code: 404 } } };
      let r = await lancia(repo, s.url, 'status');
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/BILANCI DEL GIRO NON LETTI DAL SERVER/);
      expect(r.stderr).toMatch(/Gestione → Automazioni/);
      expect(r.stderr).toMatch(/Non c'è un default/);
      expect(r.stdout).not.toMatch(/cap2 \d/);
      // Manca cap1.
      s.stato.risposta = { status: 200, body: doc(int(10), undefined, int(0)) };
      r = await lancia(repo, s.url, 'status');
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/non ha cap1/);
      // cap0 c'è ma non è un numero.
      s.stato.risposta = { status: 200, body: doc(int(10), int(1), { stringValue: 'boh' }) };
      r = await lancia(repo, s.url, 'status');
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/non ha cap0/);
      // cap2 vuoto.
      s.stato.risposta = { status: 200, body: doc({ stringValue: '' }, int(1), int(0)) };
      r = await lancia(repo, s.url, 'status');
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/non ha cap2/);
      // Il server rifiuta l'identità.
      s.stato.risposta = { status: 403, body: { error: { message: 'PERMISSION_DENIED' } } };
      r = await lancia(repo, s.url, 'status');
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/HTTP 403/);
      // I tre numeri ci sono, lo 0 compreso e uno scritto come stringa numerica: si va avanti.
      s.stato.risposta = { status: 200, body: doc(int(10), { stringValue: '1' }, { doubleValue: 0 }) };
      r = await lancia(repo, s.url, 'status');
      expect(r.stdout).toMatch(/Bilanci del giro \(dal server, config\/routines\): cap2 10 · cap1 1 · cap0 0/);
      // Il token dell'owner è arrivato al server, non un altro.
      expect(s.stato.richieste.every((q) => q.auth === 'Bearer token-finto-di-prova')).toBe(true);
    } finally {
      await s.chiudi();
    }
    // Rete giù: nessuno in ascolto.
    const r = await lancia(repo, 'http://127.0.0.1:1/config/routines', 'status');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/non letto dal server \(rete\)/);
  });

  test('`critica` senza i bilanci sul server non registra niente; con i bilanci veri calcola l\'esito (un 1 insieme a un 2 entra nel giro anche a cap1 = 0)', async () => {
    const repo = repoTemporaneo();
    const sha = git(repo, 'rev-parse', 'HEAD');
    const statoFile = join(repo, '.claude', 'verify-local.json');
    writeFileSync(statoFile, JSON.stringify({ 'claude/prova': { request: 'la richiesta', requestedSha: sha, requestedAt: '2026-09-17T00:00:00.000Z', counts: {}, derived: [], rounds: [] } }, null, 2));
    const prima = readFileSync(statoFile, 'utf8');
    const critica = 'Provato: il comando con e senza server, i tre numeri, lo zero. Funziona tutto quello che ho toccato.\n'
      + '[2] il pulsante Salva non salva col titolo vuoto: passi, apri, lascia vuoto, premi.\n'
      + '[1] il bordo del riquadro è grigio freddo dove il resto di Filo è caldo.';
    const s = await serverFinto();
    try {
      s.stato.risposta = { status: 200, body: doc(undefined, int(0), int(0)) };
      let r = await lancia(repo, s.url, 'critica', critica);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/non ha cap2/);
      expect(r.stderr).toMatch(/non ho toccato niente/);
      expect(readFileSync(statoFile, 'utf8')).toBe(prima);

      s.stato.risposta = { status: 200, body: doc(int(10), int(0), int(0)) };
      r = await lancia(repo, s.url, 'critica', critica);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Salva non salva/);
      expect(r.stdout).toMatch(/grigio freddo/);
      const e = readState(repo)['claude/prova'];
      expect(e.verdict).toBe('fix-pending');
      expect(e.pending.findings.map((f) => f.level).sort()).toEqual([1, 2]);
      expect(e.counts.count2).toBe(1);
      expect(e.counts.count1 || 0).toBe(0);
    } finally {
      await s.chiudi();
    }
  });

  test('il calcolo dell\'esito senza uno dei bilanci lancia, non inventa', () => {
    expect(() => withCritique({}, 'b', { critique: 'x'.repeat(100), sha: 'abc', caps: { cap2: 10, cap1: 1 } })).toThrow(/cap0/);
    expect(() => withCritique({}, 'b', { critique: 'x'.repeat(100), sha: 'abc', caps: null })).toThrow(/cap2, cap1, cap0/);
  });

  test('nel codice pubblico non resta un numero di ripiego per cap2/cap1/cap0', () => {
    const cartelle = ['scripts', 'src/shared', 'src/main', 'routines', '.claude/hooks', '.claude/skills'];
    const trovati = [];
    const cammina = (dir) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (n === 'node_modules') continue;
        if (statSync(p).isDirectory()) { cammina(p); continue; }
        if (!/\.(m?js|json|md|sh)$/.test(n)) continue;
        const testo = readFileSync(p, 'utf8');
        for (const [i, riga] of testo.split(/\r?\n/).entries()) {
          if (/^\s*(\/\/|#|\*)/.test(riga)) continue; // i commenti raccontano la storia (5/2/0), non sono un default
          if (/\bcap[210]\s*[:=]\s*\d/.test(riga) || /\bDEFAULT_CAPS\b/.test(riga)) trovati.push(`${p}:${i + 1}: ${riga.trim()}`);
        }
      }
    };
    for (const c of cartelle) cammina(join(ROOT, c));
    expect(trovati).toEqual([]);
  });
});

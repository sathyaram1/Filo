// Giro 1, rilievo 3: il consumo della sessione arriva al server fino al rilascio, non solo fino all'ultimo
// battito (che parte ogni dieci minuti). Rilascio vero da riga di comando, canale finto, transcript scritto qui.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CANALE = join(ROOT, 'scripts', 'routine-channel.mjs');

function canaleFinto() {
  const chiamate = [];
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(corpo || '{}'); } catch (_) { /* resta vuoto */ }
      chiamate.push({ path: req.url, payload });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, expiresAt: new Date(Date.now() + 3600e3).toISOString() }));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, chiamate, url: `http://127.0.0.1:${server.address().port}` })));
}

test('r3 al rilascio il server riceve il consumo della sessione fino a quel momento', async () => {
  const base = cartellaTemporanea('giro1-r3-coda-');
  const lavoro = join(base, 'lavoro');
  mkdirSync(join(lavoro, '.claude'), { recursive: true });
  const transcript = join(base, 'sess-coda.jsonl');
  const uso = (cr, o) => ({ input_tokens: 5, cache_read_input_tokens: cr, cache_creation_input_tokens: 2000, output_tokens: o });
  // Il lavoro degli ultimi minuti dopo l'ultimo battito: nessun battito lo ha ancora portato.
  writeFileSync(transcript, [
    { type: 'assistant', timestamp: '2026-10-09T10:00:00.000Z', sessionId: 'sess-coda', message: { id: 'm1', model: 'claude-opus-5-5', usage: uso(50000, 400), content: [{ type: 'text', text: 'a' }] } },
    { type: 'assistant', timestamp: '2026-10-09T10:05:00.000Z', sessionId: 'sess-coda', message: { id: 'm2', model: 'claude-opus-5-5', usage: uso(80000, 900), content: [{ type: 'text', text: 'b' }] } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');

  const { consumoSessione } = await import(new URL('file:///' + join(ROOT, 'scripts', 'lib', 'consumo-progressivo.mjs').replace(/\\/g, '/')).href);
  const atteso = consumoSessione({ root: join(base, 'conto'), env: { FILO_TRANSCRIPT: transcript } }).consumo;
  expect(atteso && atteso.costUsd).toBeGreaterThan(0);

  const c = await canaleFinto();
  try {
    const r = await new Promise((ok) => {
      const p = spawn(process.execPath, [CANALE, 'release', 'biglietto-di-prova-1234567890', '--role', 'verifier', '--senza-push'], {
        cwd: lavoro, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FILO_ROUTINE_API: c.url, FILO_REPO_ROOT: lavoro, FILO_TRANSCRIPT: transcript, FILO_ROUTINE: '1' },
      });
      let out = ''; let err = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { err += d; });
      const t = setTimeout(() => p.kill(), 60000);
      p.on('close', (status) => { clearTimeout(t); ok({ status, out, err }); });
    });
    expect(r.status, r.err).toBe(0);
    const conConsumo = c.chiamate.filter((x) => x.payload && x.payload.consumo && typeof x.payload.consumo.costUsd === 'number');
    expect(conConsumo.map((x) => x.path), JSON.stringify(c.chiamate.map((x) => x.path))).not.toEqual([]);
    expect(Math.max(...conConsumo.map((x) => x.payload.consumo.costUsd))).toBeCloseTo(atteso.costUsd, 4);
  } finally {
    c.server.close();
    togliCartella(base);
  }
});

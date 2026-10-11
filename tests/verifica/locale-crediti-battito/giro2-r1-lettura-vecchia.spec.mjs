// Giro 2, rilievo 1: una lettura della barra presa prima e arrivata dopo (rimandata dal battito, o rimostrata
// uguale dalla barra più tardi) non deve cancellare i dollari spesi nel frattempo. Porte vere del server su un
// Firestore in memoria; la barra è lo script vero, con l'invio che passa dritto a ownerCrediti.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERVER = [
  process.env.FILO_SECURITY_DIR || '',
  resolve(ROOT, '..', '..', '..', '..', 'filo-security', '.claude', 'worktrees', basename(ROOT)),
  resolve(ROOT, '..', 'filo-security'),
  resolve(ROOT, '..', '..', '..', '..', 'filo-security'),
].filter(Boolean).map((d) => resolve(d, 'functions')).find((d) => existsSync(resolve(d, 'src', 'routine', 'crediti.js'))) || '';

const require = createRequire(import.meta.url);
let current = null;
let crediti = null;
if (SERVER) {
  const fsMod = require(resolve(SERVER, 'src', 'data', 'firestore.js'));
  fsMod.db = () => current();
  crediti = require(resolve(SERVER, 'src', 'routine', 'crediti.js'));
}
const { memFirestore } = SERVER ? require(resolve(SERVER, 'test', 'fixtures', 'firestore-mem.js')) : {};

// Domenica 11/10/2026, 12:00 di Roma: A rinnovato martedì 06/10 alle 19:00.
const NOW = Date.parse('2026-10-11T10:00:00Z');
const MIN = 60 * 1000;

function consumo(sessionId, costUsd) {
  return { sessionId, tokens: { input: 10, cacheRead: 1000, cacheWrite: 200, output: 50 }, costUsd, turni: 10, modelli: ['claude-opus-5-5'] };
}

async function pctA(nowMs) {
  return crediti.fermiPerCrediti(await crediti.leggiCrediti(), nowMs).dettaglio.A;
}

test.describe('una lettura vecchia non cancella la spesa venuta dopo', () => {
  test.skip(!SERVER, 'filo-security non è accanto a questo repo: la metà server non si prova qui');

  test('r1 il battito che rimanda la lettura della sua sessione, presa prima, non toglie i 300 $ spesi dopo', async () => {
    current = memFirestore();
    const reset = crediti.rinnovi(NOW, 'A').successiva / 1000;
    await crediti.owner({ op: 'imposta', riservaA: 10 }, NOW);
    await crediti.depositaBattito({ consumo: consumo('sess-a1', 2050), account: 'A', slug: 'routine-a', nowMs: NOW });
    const lettura = { pct7d: 60, reset7dAtS: reset, letturaAtMs: NOW + MIN };
    await crediti.depositaMisure({ consumo: consumo('sess-a1', 2050), quota: lettura, barra: 'presente' }, { account: 'A', slug: 'routine-a', nowMs: NOW + MIN });
    expect((await pctA(NOW + MIN)).pct).toBe(60);
    // Un'altra sessione su A spende 300 $ (14 punti).
    await crediti.depositaMisure({ consumo: consumo('sess-a2', 300) }, { account: 'A', slug: 'routine-a2', nowMs: NOW + 20 * MIN });
    const prima = await pctA(NOW + 20 * MIN);
    expect(prima.pct).toBeGreaterThan(73);
    // Dieci minuti dopo la prima sessione batte ancora, con la stessa lettura di prima: la sua barra non è più girata.
    await crediti.depositaMisure({ consumo: consumo('sess-a1', 2050), quota: lettura, barra: 'presente' }, { account: 'A', slug: 'routine-a', nowMs: NOW + 30 * MIN });
    const dopo = await pctA(NOW + 30 * MIN);
    expect(dopo.pct, `prima ${JSON.stringify(prima)} dopo ${JSON.stringify(dopo)}`).toBeGreaterThanOrEqual(prima.pct);
  });

  test('r1 la barra che più tardi mostra di nuovo gli stessi numeri non toglie la spesa delle routine nel frattempo', async () => {
    current = memFirestore();
    const reset = Math.floor(crediti.rinnovi(NOW, 'A').successiva / 1000);
    await crediti.owner({ op: 'imposta', riservaA: 10 }, NOW);
    await crediti.depositaBattito({ consumo: consumo('sess-a1', 1000), account: 'A', slug: 'routine-a', nowMs: NOW });
    const SL = await import(pathToFileURL(resolve(ROOT, 'scripts', 'statusline.mjs')).href);
    const casa = cartellaTemporanea('barra-vecchia-');
    try {
      // Il fetch dell'invio arriva dritto a ownerCrediti, con l'ora del server che scorre come quella della barra.
      let oraServer = NOW;
      const fetchImpl = async (_url, init) => {
        const out = await crediti.owner(JSON.parse(init.body).data, oraServer);
        return new Response(JSON.stringify(out.ok === false ? { error: { message: out.detail } } : { result: out }), { status: out.ok === false ? 400 : 200 });
      };
      const input = JSON.stringify({ session_id: 'sess-owner', rate_limits: { five_hour: { used_percentage: 20, resets_at: Math.floor(NOW / 1000) + 3600 }, seven_day: { used_percentage: 60, resets_at: reset } } });
      // Le 12:00: la barra gira e invia, 60%.
      SL.barra(input, { home: casa, nowMs: NOW, lancia: () => {}, scrivi: () => {} });
      expect((await SL.invia({ home: casa, nowMs: NOW, fetchImpl, token: 't' })).ok).toBe(true);
      // Le routine su A spendono 430 $ (20 punti) mentre la sessione dell'owner è ferma.
      await crediti.depositaBattito({ consumo: consumo('sess-a1', 1430), account: 'A', slug: 'routine-a', nowMs: NOW + 60 * MIN });
      const prima = await pctA(NOW + 60 * MIN);
      expect(prima.pct).toBeGreaterThan(79);
      // Le 14:00: l'owner torna e la barra rigira con i numeri che Claude Code aveva dall'ultima risposta.
      oraServer = NOW + 120 * MIN;
      SL.barra(input, { home: casa, nowMs: oraServer, lancia: () => {}, scrivi: () => {} });
      await SL.invia({ home: casa, nowMs: oraServer, fetchImpl, token: 't' });
      const dopo = await pctA(oraServer);
      expect(dopo.pct, `prima ${JSON.stringify(prima)} dopo ${JSON.stringify(dopo)}`).toBeGreaterThanOrEqual(prima.pct);
    } finally {
      togliCartella(casa);
    }
  });
});

// Prova del giro 3 (verifica locale #1156): una lettura vera della barra di stato presa da una sessione locale
// sull'account B arriva al conto di B. La catena è intera: la barra vera di questo ramo salva e invia, il server vero
// del ramo omonimo di filo-security (con un Firestore in memoria) la riceve. Non apre Filo: non c'è schermata.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Il server del lavoro: il worktree di filo-security con lo stesso nome di ramo, accanto al repo pubblico.
const FUNZIONI = [
  process.env.FILO_SECURITY_FUNCTIONS || '',
  resolve(ROOT, '..', '..', '..', '..', 'filo-security', '.claude', 'worktrees', 'crediti-battito', 'functions'),
  resolve(ROOT, '..', 'filo-security', '.claude', 'worktrees', 'crediti-battito', 'functions'),
].find((d) => d && existsSync(join(d, 'src', 'routine', 'crediti.js'))) || '';

const store = new Map();
const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function unisci(a, b) {
  const out = Object.assign({}, a);
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = unisci(out[k], v);
    else out[k] = copia(v);
  }
  return out;
}
const foto = (p) => { const v = store.get(p); return { exists: v !== undefined, id: p.split('/').pop(), data: () => copia(v) }; };
const metti = (p, d, o) => { const cur = store.get(p); store.set(p, o && o.merge && cur ? unisci(cur, d) : copia(d)); };
const rif = (p) => ({ path: p, id: p.split('/').pop(), get: async () => foto(p), set: async (d, o) => metti(p, d, o) });
const dbFinto = {
  collection: (c) => ({
    doc: (id) => rif(`${c}/${id}`),
    orderBy: (f, dir) => ({ limit: (n) => ({ get: async () => {
      const docs = [...store.keys()].filter((k) => k.startsWith(`${c}/`)).map((k) => foto(k));
      docs.sort((x, y) => (dir === 'desc' ? -1 : 1) * ((x.data()[f] || 0) - (y.data()[f] || 0)));
      return { docs: docs.slice(0, n) };
    } }) }),
  }),
  doc: (p) => rif(p),
  async runTransaction(fn) {
    const scritture = [];
    const out = await fn({ get: async (r) => foto(r.path), set: (r, d, o) => scritture.push([r.path, d, o]) });
    for (const [p, d, o] of scritture) metti(p, d, o);
    return out;
  },
};

function crediti() {
  const req = createRequire(join(FUNZIONI, 'index.js'));
  const fs = req.resolve(join(FUNZIONI, 'src', 'data', 'firestore.js'));
  req.cache[fs] = { id: fs, filename: fs, loaded: true, exports: { db: () => dbFinto, app: () => ({}) } };
  return req(join(FUNZIONI, 'src', 'routine', 'crediti.js'));
}

let casa = '';
test.afterAll(() => { if (casa) togliCartella(casa); });

test('r1 la barra di una sessione locale sull\'account B corregge la stima di B', async () => {
  test.skip(!FUNZIONI, 'manca il server del lavoro accanto al repo pubblico');
  store.clear();
  const C = crediti();
  const SL = await import('file:///' + join(ROOT, 'scripts', 'statusline.mjs').replace(/\\/g, '/'));
  casa = cartellaTemporanea('filo-verifica-1156-r1-');
  const ora = Date.now();
  // Le routine di B hanno speso 1.000 dollari: la stima dice 46,5%.
  await C.depositaMisure({ consumo: { sessionId: 'routine-b-1', tokens: { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 }, costUsd: 1000, turni: 3, modelli: ['claude-opus-5-5'] } }, { account: 'B', slug: 'cloud-b', nowMs: ora - 60000 });
  // L'owner apre Claude Code sull'account B: la barra riceve la percentuale vera, 30%, col rinnovo di B.
  const rinnovoB = C.rinnovi(ora, 'B').successiva;
  const ingresso = { session_id: 'owner-su-b', rate_limits: { five_hour: { used_percentage: 12, resets_at: Math.floor(ora / 1000) + 3600 }, seven_day: { used_percentage: 30, resets_at: Math.floor(rinnovoB / 1000) } } };
  let righe = '';
  SL.barra(JSON.stringify(ingresso), { home: casa, nowMs: ora, lancia: () => {}, scrivi: (s) => { righe += s; } });
  expect(righe).toContain('7g 30%');
  // L'invio passa dal server vero come lo chiama la funzione pubblicata (un rifiuto è un errore della chiamata).
  const fetchImpl = async (_url, init) => {
    const out = await C.owner(JSON.parse(init.body).data, Date.now());
    if (out && out.ok === false) return new Response(JSON.stringify({ error: { message: out.detail || out.reason } }), { status: 400 });
    return new Response(JSON.stringify({ result: out }), { status: 200 });
  };
  const esito = await SL.invia({ home: casa, token: 'token-finto', fetchImpl });
  expect(esito.errore).toBe('');
  expect(esito.ok).toBe(true);
  const stato = await C.owner({ op: 'stato' }, Date.now());
  expect(stato.accounts.B.lettura).toBe(30);
  expect(stato.accounts.B.pct).toBe(30);
  expect(stato.accounts.A.lettura).toBe(null);
});

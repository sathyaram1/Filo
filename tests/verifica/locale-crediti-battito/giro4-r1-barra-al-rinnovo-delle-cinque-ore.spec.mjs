// Prova del giro 4 (verifica locale) sui crediti: la barra di stato vera, il server dei crediti vero con un
// Firestore in memoria, la riserva di A. Non apre Filo. Il server lo cerca accanto (worktree filo-security con
// lo stesso nome di ramo, poi il checkout); se non c'è, la prova si salta.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

function functionsServer() {
  const ramo = basename(ROOT);
  let dir = ROOT;
  for (let i = 0; i < 7; i++) {
    for (const f of [join(dir, 'filo-security', '.claude', 'worktrees', ramo, 'functions'), join(dir, 'filo-security', 'functions')]) {
      if (existsSync(join(f, 'src', 'routine', 'crediti.js'))) return f;
    }
    dir = dirname(dir);
  }
  return '';
}
const FN = functionsServer();

/** Firestore in memoria quanto basta ai crediti: get/set con merge profondo, transazioni, orderBy/limit. */
function firestoreFinto() {
  const dati = new Map();
  const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const ogg = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const unisci = (a, b) => { const o = ogg(a) ? copia(a) : {}; for (const [k, v] of Object.entries(b)) o[k] = ogg(v) && ogg(o[k]) ? unisci(o[k], v) : copia(v); return o; };
  const ref = (col, id) => ({
    id,
    async get() { const d = dati.get(`${col}/${id}`); return { exists: d !== undefined, id, data: () => copia(d) }; },
    async set(d, o) { const k = `${col}/${id}`; dati.set(k, o && o.merge ? unisci(dati.get(k), d) : copia(d)); },
  });
  const db = {
    collection: (col) => ({
      doc: (id) => ref(col, id),
      orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
    doc: (p) => { const [c, ...r] = p.split('/'); return ref(c, r.join('/')); },
    async runTransaction(fn) {
      const scritture = [];
      const out = await fn({ get: (r) => r.get(), set: (r, d, o) => scritture.push([r, d, o]) });
      for (const [r, d, o] of scritture) await r.set(d, o);
      return out;
    },
  };
  return { db, dati };
}

test('r1 una sessione locale ferma, al rinnovo delle cinque ore, non riporta indietro A: la riserva resta', async () => {
  test.skip(!FN, 'repo del server non trovato accanto');
  const finto = firestoreFinto();
  const fsMod = require.resolve(join(FN, 'src', 'data', 'firestore.js'));
  require.cache[fsMod] = { id: fsMod, filename: fsMod, loaded: true, exports: { db: () => finto.db, app: () => ({}) } };
  const cr = require(join(FN, 'src', 'routine', 'crediti.js'));
  const barraMod = await import(pathToFileURL(join(ROOT, 'scripts', 'statusline.mjs')).href);

  const casa = cartellaTemporanea('giro4-r1-barra-');
  try {
    let ora = Date.parse('2026-10-11T10:00:00Z');
    const rinnovoA = cr.rinnovi(ora, 'A').successiva;
    const rinnovo5h = ora + 3.5 * 3600e3;
    await finto.db.collection('routine-keys').doc('routine-a').set({ account: 'A' });
    await cr.owner({ op: 'imposta', riservaA: 10, tettoB: 100 }, ora);

    // La barra manda al server com'è: la risposta dell'owner, le stesse regole HTTP della funzione vera.
    const inviati = [];
    const fetchImpl = async (_url, o) => {
      const corpo = JSON.parse(o.body);
      inviati.push(corpo.data);
      const out = await cr.owner(corpo.data, ora);
      if (out && out.ok === false) return { status: 400, ok: false, json: async () => ({ error: { message: out.detail } }) };
      return { status: 200, ok: true, json: async () => ({ result: out }) };
    };
    let invii = [];
    const lancia = (h) => { invii.push(barraMod.invia({ home: h, nowMs: ora, fetchImpl, token: 'finto' })); };
    const gira = async (input) => {
      barraMod.barra(JSON.stringify(input), { home: casa, nowMs: ora, lancia, scrivi: () => {} });
      await Promise.all(invii); invii = [];
    };

    // 12:00 a Roma: l'owner riceve una risposta, A è al 60 per cento.
    await gira({ session_id: 'owner-a', rate_limits: {
      five_hour: { used_percentage: 20, resets_at: rinnovo5h / 1000 },
      seven_day: { used_percentage: 60, resets_at: rinnovoA / 1000 },
    } });
    expect(inviati.length).toBe(1);

    // L'owner si allontana; le routine di A spendono 650 dollari: A è oltre la sua soglia del 90.
    for (const usd of [200, 450, 650]) {
      ora += 40 * 60e3;
      await cr.depositaMisure({ consumo: { sessionId: 'routine-a-1', tokens: { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 }, costUsd: usd, turni: 3, modelli: ['claude-opus-5-5'] } },
        { account: 'A', slug: 'routine-a', nowMs: ora });
    }
    const doc = async () => (await finto.db.doc('routine-state/crediti').get()).data();
    const prima = cr.percentualeDecisione(await doc(), 'A', ora).pct;
    expect(prima).toBeGreaterThanOrEqual(90);
    expect(cr.fermiPerCrediti(await doc(), ora).fermi.A).toBe(true);

    // Passa il rinnovo delle cinque ore: Claude Code rigira da solo la barra della sessione ferma, coi numeri della
    // settimana dell'ultima risposta e senza più la finestra delle cinque ore (documentato: «present only while
    // ... its resets_at has not passed»). Nessuna risposta nuova: non è una lettura nuova.
    ora = rinnovo5h + 1000;
    await gira({ session_id: 'owner-a', rate_limits: { seven_day: { used_percentage: 60, resets_at: rinnovoA / 1000 } } });

    const dopo = cr.percentualeDecisione(await doc(), 'A', ora).pct;
    expect(dopo, `A era al ${prima} per cento prima che la barra rigirasse`).toBeGreaterThanOrEqual(prima);
    expect(cr.fermiPerCrediti(await doc(), ora).fermi.A, 'A deve restare ferma oltre la riserva').toBe(true);
  } finally {
    togliCartella(casa);
  }
});

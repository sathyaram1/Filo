// Verifica #1156 giro 6, rilievo 1: il numero del rinnovo dato o tolto dall'owner a settimana avviata non deve
// buttare i dollari spesi dopo il nuovo inizio della settimana. Gira sul modulo vero dei crediti del ramo server
// gemello, con un Firestore in memoria; senza Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaDelServer } from '../../../scripts/lib/ramo-server.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function funzioniDelServer() {
  if (process.env.FILO_SERVER_FUNCTIONS) return process.env.FILO_SERVER_FUNCTIONS;
  const principale = cartellaDelServer(RADICE);
  if (!principale) return '';
  const gemello = join(dirname(principale), '.claude', 'worktrees', basename(RADICE), 'functions');
  return existsSync(join(gemello, 'src', 'routine', 'crediti.js')) ? gemello : principale;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const copia = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function unisci(a, b) {
  const out = isObj(a) ? copia(a) : {};
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(out[k]) ? unisci(out[k], v) : copia(v);
  return out;
}

function firestoreFinto() {
  const dati = new Map();
  const snap = (p) => ({ exists: dati.has(p), id: p.split('/').pop(), data: () => copia(dati.get(p)) });
  const scrivi = (p, d, o) => dati.set(p, o && o.merge && dati.has(p) ? unisci(dati.get(p), d) : copia(d));
  const rif = (p) => ({ id: p.split('/').pop(), path: p, get: async () => snap(p), set: async (d, o) => scrivi(p, d, o) });
  const collezione = (c) => {
    const q = (ord, lim) => ({
      orderBy: (f, dir) => q({ f, dir }, lim),
      limit: (n) => q(ord, n),
      where: () => q(ord, lim),
      get: async () => {
        let docs = [...dati.keys()].filter((k) => k.startsWith(`${c}/`)).map(snap);
        if (ord) docs.sort((x, y) => (ord.dir === 'desc' ? -1 : 1) * ((x.data()[ord.f] || 0) - (y.data()[ord.f] || 0)));
        if (lim) docs = docs.slice(0, lim);
        return { docs, empty: !docs.length, size: docs.length };
      },
    });
    return Object.assign(q(null, null), { doc: (id) => rif(`${c}/${id}`) });
  };
  return {
    collection: collezione,
    doc: rif,
    runTransaction: async (fn) => fn({ get: async (r) => snap(r.path), set: (r, d, o) => scrivi(r.path, d, o) }),
  };
}

function creditiConDb(funzioni) {
  const require = createRequire(join(funzioni, 'package.json'));
  const fsPath = require.resolve(join(funzioni, 'src', 'data', 'firestore.js'));
  const db = firestoreFinto();
  require.cache[fsPath] = { id: fsPath, filename: fsPath, loaded: true, exports: { app: () => ({}), db: () => db } };
  for (const k of Object.keys(require.cache)) if (k.endsWith(`${sep}routine${sep}crediti.js`)) delete require.cache[k];
  return require(join(funzioni, 'src', 'routine', 'crediti.js'));
}

const U = (s) => Date.parse(s);
const consumo = (sessionId, costUsd) => ({ sessionId, tokens: { input: 1, cacheRead: 1, cacheWrite: 1, output: 1 }, costUsd, turni: 1, modelli: [] });
const FUNZIONI = funzioniDelServer();

test.skip(!FUNZIONI, 'filo-security non è accanto al repo: il modulo dei crediti non si può far girare');

test('r1 il numero del rinnovo dato a settimana avviata tiene i dollari spesi dopo il rinnovo vero', async () => {
  const crediti = creditiConDb(FUNZIONI);
  await crediti.owner({ op: 'imposta', riservaA: 10, tettoB: 80 }, U('2026-10-20T08:00:00Z'));
  // B è un account nuovo che rinnova il venerdì alle 12 UTC; le sue routine spendono sabato e lunedì.
  await crediti.depositaMisure({ consumo: consumo('b1', 900) }, { account: 'B', slug: 'kb', nowMs: U('2026-10-24T10:00:00Z') });
  await crediti.depositaMisure({ consumo: consumo('b2', 700) }, { account: 'B', slug: 'kb', nowMs: U('2026-10-26T10:00:00Z') });
  const imp = await crediti.owner({ op: 'imposta', rinnovoB: U('2026-10-23T12:00:00Z') }, U('2026-10-26T10:10:00Z'));
  expect(imp.ok).toBe(true);
  const st = await crediti.owner({ op: 'stato' }, U('2026-10-26T10:11:00Z'));
  expect(new Date(st.accounts.B.settimanaDaMs).toISOString()).toBe('2026-10-23T12:00:00.000Z');
  expect(st.accounts.B.usdSettimana).toBe(1600);
});

test('r1 il numero del rinnovo tolto a settimana avviata tiene i dollari spesi dopo il rinnovo scritto', async () => {
  const crediti = creditiConDb(FUNZIONI);
  await crediti.owner({ op: 'imposta', riservaA: 10, tettoB: 80, rinnovoB: U('2026-10-23T12:00:00Z') }, U('2026-10-22T08:00:00Z'));
  await crediti.depositaMisure({ consumo: consumo('b1', 1500) }, { account: 'B', slug: 'kb', nowMs: U('2026-10-24T10:00:00Z') });
  await crediti.owner({ op: 'imposta', rinnovoB: null }, U('2026-10-26T10:01:00Z'));
  const st = await crediti.owner({ op: 'stato' }, U('2026-10-26T10:02:00Z'));
  // Il rinnovo scritto di B è il mercoledì 21 alle 7 UTC: i 1.500 dollari di sabato 24 sono di questa settimana.
  expect(new Date(st.accounts.B.settimanaDaMs).toISOString()).toBe('2026-10-21T07:00:00.000Z');
  expect(st.accounts.B.usdSettimana).toBe(1500);
});

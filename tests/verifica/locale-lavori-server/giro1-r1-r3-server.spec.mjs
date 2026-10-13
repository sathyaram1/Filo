// Verifica locale #1159, giro 1: rilievi 1 e 3 sulla parte del server (logica pura, Firestore in memoria, niente rete).
// Il codice del server si cerca nel worktree gemello di filo-security (stesso nome), o in FILO_SERVER_FUNCTIONS.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
function cartellaServer() {
  if (process.env.FILO_SERVER_FUNCTIONS) return resolve(process.env.FILO_SERVER_FUNCTIONS);
  const parti = APP.split(sep);
  const i = parti.lastIndexOf('worktrees');
  if (i > 1 && parti[i - 1] === '.claude') {
    const base = parti.slice(0, i - 2).join(sep);
    const gemello = join(base, 'filo-security', '.claude', 'worktrees', parti[i + 1], 'functions');
    if (existsSync(gemello)) return gemello;
    return join(base, 'filo-security', 'functions');
  }
  return join(dirname(APP), 'filo-security', 'functions');
}
const S = cartellaServer();
const require = createRequire(join(S, 'package.json'));
const R = (p) => require(join(S, p));

const { memFirestore } = R('test/fixtures/firestore-mem.js');
let current = null;
R('src/data/firestore').db = () => current();
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GH_LAVORI_APP_ID = '1';
process.env.GH_LAVORI_APP_PRIVATE_KEY = privateKey.export({ type: 'pkcs1', format: 'pem' });
const github = R('src/routine/github');
const deliver = R('src/routine/deliver');
const stall = R('src/routine/stall');
const gitToken = R('src/routine/gitToken');
const pacemaker = R('src/routine/pacemaker');

const NOW = Date.parse('2026-10-13T12:00:00Z');
const H = 3600e3;

test('r1 un lavoro server fidato che una sessione locale ha in mano non torna alle routine quando i lavori server sono accesi', async () => {
  // La sessione locale l'ha preso in carico tre ore fa («In lavorazione»), lavora sul server e sull'app da due ore non
  // committa (prove lunghe): nessuna routine l'ha mai avuto, quindi nessun semaforo delle routine.
  const fb = {
    _id: 'F1', status: 'working', seq: 9, branch: 'claude/lavoro-x', fiducia: 'fidato',
    workingSince: new Date(NOW - 3 * H).toISOString(), createdAt: new Date(NOW - 5 * H).toISOString(),
    localOnly: { by: 'owner', at: NOW - 5 * H },
  };
  current = memFirestore({
    'feedback/F1': fb,
    'routine-local-tickets/locale1': { natoIl: NOW - 3 * H, fiducia: 'fidato', rami: ['app:claude~lavoro-x', 'server:claude~lavoro-x'] },
    'routine-branches/app:claude~lavoro-x': { scrittoDa: [{ biglietto: 'locale1', fiducia: 'fidato', sha: 'a'.repeat(40), via: 'locale', at: NOW - 2 * H }] },
  });
  github.headCommit = async () => ({ ok: true, sha: 'a'.repeat(40), committedAtMs: NOW - 2 * H });
  const spostati = [];
  deliver.applyStatus = async (id, doc, to) => { spostati.push({ id, to }); return { ok: true }; };
  deliver.recordStall = async () => {};

  // Con l'interruttore spento la sessione lo tiene (comportamento di prima).
  await stall.sweepStalled([fb], { nowMs: NOW, lavoriServer: false });
  expect(spostati).toEqual([]);
  // Acceso: la sessione deve tenerlo lo stesso, o una routine lo rifà mentre lei ci lavora.
  await stall.sweepStalled([fb], { nowMs: NOW, lavoriServer: true });
  expect(spostati).toEqual([]);
});

test('r3 la parola d’ordine revocata spegne anche il token di filo-lavori del suo biglietto', async () => {
  const fp = 'f'.repeat(64);
  const token = 'ghs_TOKENDIPROVA';
  current = memFirestore({
    'routine-keys/rA': { fp: 'k', revoked: true },
    [`routine-tickets/${fp}`]: { slug: 'rA', role: 'new-work', feedbackId: 'F1', leaseId: 'L1', fiducia: 'fidato', ambiti: ['server'], openedAtMs: NOW - H },
    'routine-leases/L1': { holder: fp, expiresAtMs: NOW + 2 * H },
    [`routine-git-tokens/${fp}`]: {
      attivo: true, emessi: 1, scadeIl: NOW + 50 * 60e3, impronta: gitToken.impronta(token),
      cifrato: gitToken.cifra(token, `${process.env.GH_LAVORI_APP_PRIVATE_KEY}\n`),
    },
  });
  const revocati = [];
  const fetchImpl = async (u, o = {}) => {
    if (String(o.method || '').toUpperCase() === 'DELETE') revocati.push(o.headers.Authorization);
    return { status: 204, json: async () => ({}), text: async () => '' };
  };
  await pacemaker.revocaTokenOrfani(NOW, fetchImpl, { allarme: async () => {} });
  // Il canale rifiuta già ogni chiamata del biglietto: il suo token non deve restare buono fino alla scadenza.
  expect(revocati).toEqual([`Bearer ${token}`]);
});

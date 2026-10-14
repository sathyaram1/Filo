// Verifica #1222, giro 1, rilievo 1: il cancello porta su main di filo-security un ramo del server senza guardare i
// verdetti né il ruolo di chi chiede. Dopo un controllo di sicurezza bocciato, un biglietto vivo della pratica (quello
// del controllo stesso, o del correttore del giro dopo) chiede la fusione e main avanza. Atteso: niente avanzamento.
import { test, expect } from '@playwright/test';
import { cartellaFunctions, richiedi, githubFinto, X } from './helpers/server.mjs';

test.skip(!cartellaFunctions(), 'filo-security non è accanto al repo');

const RAMO = 'claude/prova-server';
const SEGRETO = 'biglietto-di-prova-1222';

function banco({ ruolo, stato }) {
  const channel = richiedi('src/routine/channel.js');
  const store = richiedi('src/routine/store.js');
  const secrets = richiedi('src/routine/secrets.js');
  const fp = secrets.fingerprint(SEGRETO);
  const ora = Date.now();
  Object.assign(store, {
    readTicket: async (f) => (f === fp ? { role: ruolo, slug: 'chiave-prova', feedbackId: 'fb-1222', num: '9999', branch: RAMO, leaseId: 'l1', openedAtMs: ora - 1000, fiducia: 'fidato' } : null),
    readLease: async () => ({ holder: fp, expiresAtMs: ora + 3_600_000 }),
    keyIsLive: async () => true,
    touchSystemBeat: async () => {},
  });
  const gh = githubFinto();
  const doc = { _id: 'fb-1222', localOnly: { by: 'owner' }, fiducia: 'fidato', status: stato.secauditVerdict === 'fail' ? 'design' : 'working', branch: RAMO, attesa: '' };
  const registro = { scrittoDa: [{ biglietto: 'w1', fiducia: 'fidato', sha: X, via: 'consegna' }] };
  const scritture = [];
  const server = {
    readState: async () => stato,
    writeState: async (id, p) => { scritture.push(p); },
    readRamo: async () => registro,
    registraSulRamo: async () => {},
    scriviFeedback: async () => {},
    annota: async () => ({ ok: true }),
    realign: async () => ({ ok: true }),
    portaAllOwner: async () => ({ ok: true }),
  };
  const deps = { readState: async () => stato, readFeedback: async () => doc, github: gh, gates: () => ({ passed: true, trips: [] }), server };
  return { channel, gh, deps, ora };
}

test('r1 dopo un controllo di sicurezza bocciato, il biglietto del controllo non porta il ramo del server su main', async () => {
  const stato = {
    branch: RAMO, lavoroServer: true, verifierVerdict: 'pass', verifiedSha: 'c'.repeat(40),
    secauditDone: true, secauditVerdict: 'fail', secauditSha: 'c'.repeat(40), secauditShaServer: X,
  };
  const { channel, gh, deps, ora } = banco({ ruolo: 'secaudit', stato });
  const r = await channel.merge({ ticket: SEGRETO, branch: RAMO, nowMs: ora, deps });
  expect(gh.chiamate.avanzaMain, `risposta del cancello: ${JSON.stringify(r)}`).toEqual([]);
  expect(r.result).not.toBe('merged');
});

test('r1 il correttore del giro dopo una bocciatura non porta su main il ramo bocciato chiedendo la fusione lui', async () => {
  // Lo stato dopo la ripresa: i verdetti azzerati, i segni del lavoro server rimasti.
  const stato = {
    branch: RAMO, lavoroServer: true, verifierVerdict: null, verifiedSha: '',
    secauditDone: false, secauditVerdict: null, secauditSha: '', secauditShaServer: X,
  };
  const { channel, gh, deps, ora } = banco({ ruolo: 'fixer', stato });
  const r = await channel.merge({ ticket: SEGRETO, branch: RAMO, nowMs: ora, deps });
  expect(gh.chiamate.avanzaMain, `risposta del cancello: ${JSON.stringify(r)}`).toEqual([]);
  expect(r.result).not.toBe('merged');
});

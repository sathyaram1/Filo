// Verifica locale «fiducia» (#1148), giro 1, rilievo 1: nel registro del ramo le consegne delle routine (la revisione
// del lavoro nuovo, la correzione) entrano senza lo sha che hanno spinto. Server vero (consegna e registro), Firestore
// in memoria. I dati delle consegne sono quelli che i client mandano oggi: se la cura li cambia, la prova li segue.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RADICE = join(import.meta.dirname, '..', '..', '..');
function funzioniDelServer() {
  let ramo = '';
  try { ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim(); } catch (_) {}
  const slug = ramo.replace(/^claude\//, '');
  let d = RADICE;
  for (let i = 0; i < 8; i++) {
    const srv = join(dirname(d), 'filo-security');
    for (const c of [join(srv, '.claude', 'worktrees', slug, 'functions'), join(srv, 'functions')]) {
      if (slug && existsSync(join(c, 'src', 'fiduciaRamo.js'))) return c;
    }
    d = dirname(d);
  }
  return '';
}

const SRV = funzioniDelServer();
const RAMO = 'worker/fid-1';
const H1 = '1'.repeat(40); const F1 = 'f'.repeat(40); const X = 'e'.repeat(40);

async function server() {
  const require = createRequire(join(SRV, 'index.js'));
  const { memFirestore } = require(join(SRV, 'test', 'fixtures', 'firestore-mem'));
  const fsMod = require(join(SRV, 'src', 'data', 'firestore'));
  fsMod.db = () => globalThis.__memVerifica1148();
  const crypto = require(join(SRV, 'src', 'feedbackCrypto'));
  crypto.encryptForOwner = async (t) => String(t);
  const store = require(join(SRV, 'src', 'routine', 'store'));
  const deliver = require(join(SRV, 'src', 'routine', 'deliver'));
  const fiduciaRamo = require(join(SRV, 'src', 'fiduciaRamo'));
  const { fixedPayload } = await import(pathToFileURL(join(RADICE, 'scripts', 'dispatch.mjs')).href);
  const mem = memFirestore({
    'feedback/fid': { seq: 7, subSeq: 0, status: 'working', statusPublic: 'open', fiducia: 'fidato', notes: '' },
    'routine-tickets/t1': { role: 'new-work', fiducia: 'fidato', branch: '', feedbackId: 'fid', slug: 's', leaseId: 'l' },
    'routine-tickets/t2': { role: 'verifier', fiducia: 'fidato', branch: RAMO, feedbackId: 'fid', slug: 's', leaseId: 'l' },
    'routine-tickets/t3': { role: 'fixer', fiducia: 'fidato', branch: RAMO, feedbackId: 'fid', slug: 's', leaseId: 'l' },
    'routine-tickets/t4': { role: 'verifier', fiducia: 'fidato', branch: RAMO, feedbackId: 'fid', slug: 's', leaseId: 'l' },
    'routine-keys/s': {},
  });
  globalThis.__memVerifica1148 = () => mem();
  const live = (fp) => ({ ok: true, fp, ticket: mem.doc(`routine-tickets/${fp}`) });
  // Come in channel.issueTicket: chi può spingere entra nel registro con la punta che trova.
  const emissione = (fp, punta) => store.registraSulRamo({ repo: 'app', ramo: RAMO, feedbackId: 'fid', fp, sha: punta, punta, via: fiduciaRamo.VIA.EMISSIONE });
  // Dal #1362 il pre-push accoda i commit che la sessione crea e la consegna li dichiara prima di partire, poi porta i
  // commit del ramo oltre main coi genitori: la prova li segue.
  const dichiara = (fp, sha) => store.dichiaraSulRamo({ repo: 'app', ramo: RAMO, fp, spinte: [{ punta: sha, commits: [sha] }] });
  const STORIA = { [H1]: [], [F1]: [H1] };
  const oltreMain = (sha) => (sha === F1 ? [F1, H1] : [H1]).map((c) => ({ sha: c, parents: STORIA[c] }));
  // routine-channel deliver status --status revision_capability --notes … --frase … --branch …
  // Dal giro 2 lo strumento timbra la punta anche su revisione e correzione: la prova lo segue.
  const revisione = async (sha) => {
    await dichiara('t1', sha);
    return deliver.applyDelivery(live('t1'), 'status', { status: 'revision_capability', notes: 'report', userNote: 'frase', branch: RAMO, sha, commits: oltreMain(sha) }, {}, Date.now());
  };
  const correzione = async (fp, sha) => {
    await mem().doc('feedback/fid').update({ status: 'revision_capability' });
    await dichiara(fp, sha);
    return deliver.applyDelivery(live(fp), 'fixed', Object.assign(fixedPayload({ report: 'corretto', frase: 'f', branch: RAMO, sha }), { commits: oltreMain(sha) }), {}, Date.now());
  };
  return { store, fiduciaRamo, emissione, revisione, correzione };
}

test('r1 lavoro fidato scritto solo da biglietti puliti, con un giro di correzione: resta fidato', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const s = await server();
  expect((await s.revisione(H1)).ok).toBe(true);
  await s.emissione('t3', H1);
  expect((await s.correzione('t3', F1)).ok).toBe(true);
  // il fixer ha spinto F1: il verificatore dopo trova F1 come punta
  await s.emissione('t4', F1);
  const ramo = await s.store.readRamo('app', RAMO);
  const voci = ramo.scrittoDa.map((v) => `${v.biglietto}/${v.via}/${v.sha.slice(0, 4) || 'senza sha'}`).join(', ');
  expect(ramo.buco, `registro: ${voci}`).toBe(false);
  expect(s.fiduciaRamo.lavoroFidato({ feedback: { fiducia: 'fidato' }, ramo, sha: F1 })).toBe(true);
});

test('r1 un commit spinto fuori registro fra la revisione e la verifica non entra come pulito', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const s = await server();
  expect((await s.revisione(H1)).ok).toBe(true);
  // il lavoro nuovo ha spinto H1; qualcun altro spinge X; il verificatore trova X come punta
  await s.emissione('t2', X);
  const ramo = await s.store.readRamo('app', RAMO);
  expect(s.fiduciaRamo.lavoroFidato({ feedback: { fiducia: 'fidato' }, ramo, sha: X }), 'X non l’ha consegnato nessun biglietto del registro').toBe(false);
});

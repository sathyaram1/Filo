// #1903.1 giro 1, rilievo 1: il pacchetto nasce con le attese delle unite, ma i controlli prima di aprire
// non le vedono. Rete finta (come tests/unit/pacchettoApri.test.mjs): si guarda cosa arriva a submit.
import { test, expect } from '@playwright/test';

const SCRIPT = await import('../../../scripts/claude-feedback.mjs');
const FB = globalThis.SN_FEEDBACK;
const ATT = globalThis.SN_FB_ATTESE;
SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
SCRIPT.ambiente.routine = () => false;

const id = (n) => `idaaaaaaaaaaaaaaaa${n}`;
const seg = (num, attese = []) => ({ ok: true, id: id(num), num, stato: 'todo', priorita: 1, locale: false, attese });

async function conRete({ lette, righe = [] }, fn) {
  const P = SCRIPT.pacchetto;
  const orig = { submit: FB.submit, ...P, log: console.log, err: console.error };
  const grafo = new Map(righe.map((r) => [r._id, ATT.atteseDi(r)]));
  const visti = { submit: [], archiviate: [], err: [] };
  FB.submit = async (payload, opts) => { visti.submit.push(opts); grafo.set(id('pacco'), opts.waitsFor || []); return { id: id('pacco'), seq: 900, senderProof: 'admin' }; };
  P.leggi = async (numeri) => numeri.map((n) => lette[n] || { ok: false, num: n, motivo: `nessun feedback #${n}` });
  P.allegati = async () => [];
  P.attesiDa = async (unite) => SCRIPT.chiAspetta(righe, unite);
  // Come la scrittura vera delle attese: rifiuta un giro, guardando il grafo intero.
  P.sposta = async (x, voce) => {
    const tenute = (grafo.get(x.id) || []).filter((w) => !x.togli.includes(w.id));
    const v = await ATT.valida({
      id: x.id, num: x.num, numeri: [...tenute.map((w) => w.num), voce.num],
      risolvi: async (n) => (n === '900' ? id('pacco') : id(n)),
      leggiAttese: async (ids) => new Map(ids.map((i) => [i, grafo.get(i) || []])),
    });
    return v.ok ? { ok: true } : { ok: false, motivo: v.motivo };
  };
  P.archivia = async (u) => { visti.archiviate.push(u.num); return { ok: true }; };
  console.log = () => {};
  console.error = (...a) => visti.err.push(a.join(' '));
  try { return { code: await fn(), ...visti }; } finally {
    FB.submit = orig.submit;
    for (const k of ['leggi', 'allegati', 'attesiDa', 'sposta', 'archivia']) P[k] = orig[k];
    console.log = orig.log; console.error = orig.err;
  }
}

test('r1 una spec che dice «#812 solo dopo #700», quando #812 aspetta già #700, apre il pacchetto che aspetta #700', async () => {
  const r = await conRete({ lette: { 812: seg('812', [{ id: id(700), num: '700' }]), 815: seg('815') } },
    () => SCRIPT.main(['Menu', '#812: la voce manca, solo dopo #700. Si prova aprendo il menu.\n#815: il hover, si prova passando sopra.', '--non-locale', '--pacchetto', '812,815']));
  expect(r.err.join('\n')).not.toMatch(/il pacchetto non lo aspetta/);
  expect(r.code).toBe(0);
  expect(r.submit[0].waitsFor).toEqual([{ id: id(700), num: '700' }]);
});

test('r1 un giro di attese a catena chiuso da un\'attesa ereditata si dice prima di aprire, senza un pacchetto a metà', async () => {
  // #815 aspetta #700, #700 aspetta #701, #701 aspetta #812: il pacchetto aspetterebbe #700 e #701 aspetterebbe il pacchetto.
  const righe = [
    { _id: id(700), seq: 700, waitsFor: [{ id: id(701), num: '701' }] },
    { _id: id(701), seq: 701, waitsFor: [{ id: id(812), num: '812' }] },
    { _id: id(812), seq: 812, waitsFor: [] },
    { _id: id(815), seq: 815, waitsFor: [{ id: id(700), num: '700' }] },
  ];
  const r = await conRete({ lette: { 812: seg('812'), 815: seg('815', [{ id: id(700), num: '700' }]) }, righe },
    () => SCRIPT.main(['Menu', '#812: cambia, si prova così.\n#815: cambia, si prova così.', '--non-locale', '--pacchetto', '812,815']));
  expect(r.submit.length, 'il pacchetto non deve nascere: non potrebbe archiviare #812').toBe(0);
  expect(r.archiviate).toEqual([]);
  expect(r.err.join('\n')).toMatch(/aspetterebbero a vicenda|giro/);
});

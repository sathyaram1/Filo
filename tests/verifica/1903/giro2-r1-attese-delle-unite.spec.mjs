// Verifica #1903 giro 2: una unita che aspetta un altro lavoro, archiviata alla nascita del pacchetto, perde la sua
// attesa in silenzio: il pacchetto parte subito e fa anche il suo pezzo prima che quel lavoro sia arrivato.
import { test, expect } from '@playwright/test';

const SCRIPT = await import('../../../scripts/claude-feedback.mjs');
const FB = globalThis.SN_FEEDBACK;

test('r1 l\'attesa di una unita non sparisce quando il pacchetto la archivia', async () => {
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
  SCRIPT.ambiente.routine = () => false;
  const P = SCRIPT.pacchetto;
  const orig = { submit: FB.submit, leggi: P.leggi, allegati: P.allegati, attesiDa: P.attesiDa, archivia: P.archivia, sposta: P.sposta, log: console.log, err: console.error };
  const submit = [];
  const archiviate = [];
  const err = [];
  // #812 aspetta #700 (aperto, non un pacchetto): finché #700 non è su main il suo lavoro non deve partire.
  const voci = {
    700: { ok: true, id: 'id700', num: '700', stato: 'working', priorita: 1, locale: false, attese: [], ramo: 'worker/x', unisce: [], fidato: true },
    812: { ok: true, id: 'id812', num: '812', stato: 'todo', priorita: 1, locale: false, attese: [{ id: 'id700', num: '700' }], ramo: '', unisce: [], fidato: true },
    815: { ok: true, id: 'id815', num: '815', stato: 'todo', priorita: 1, locale: false, attese: [], ramo: '', unisce: [], fidato: true },
  };
  FB.submit = async (payload, opts) => { submit.push({ payload, opts }); return { id: 'pacco', seq: 950, senderProof: 'admin' }; };
  P.leggi = async (numeri) => numeri.map((n) => voci[String(n).replace(/^#/, '')] || { ok: false, num: n, motivo: `nessun feedback #${n}` });
  P.allegati = async () => [];
  P.attesiDa = async () => [];
  P.archivia = async (u) => { archiviate.push(u.num); return { ok: true }; };
  P.sposta = async () => ({ ok: true });
  console.log = () => {};
  console.error = (...a) => err.push(a.join(' '));
  let code;
  try {
    code = await SCRIPT.main(['Pacchetto', 'spec', '--non-locale', '--pacchetto', '812,815']);
  } finally {
    FB.submit = orig.submit; P.leggi = orig.leggi; P.allegati = orig.allegati; P.attesiDa = orig.attesiDa; P.archivia = orig.archivia; P.sposta = orig.sposta;
    console.log = orig.log; console.error = orig.err;
  }
  const attesePacchetto = submit.length ? (submit[0].opts.waitsFor || []).map((w) => w.id) : [];
  // Due cure accettabili: il pacchetto eredita l'attesa, oppure lo strumento non apre e nomina #700.
  const ereditata = submit.length === 1 && attesePacchetto.includes('id700');
  const detta = submit.length === 0 && code !== 0 && /#700/.test(err.join('\n'));
  expect(ereditata || detta, `il pacchetto nasce con attese [${attesePacchetto.join(', ')}] e archivia ${archiviate.join(', ')}: l'attesa di #812 su #700 è sparita`).toBe(true);
});

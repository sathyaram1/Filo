// Verifica #1903 giro 1: una unita rimasta in coda col rimando a un pacchetto aperto (archiviazione mancata, pacchetto
// nato senza numero) non entra in un secondo pacchetto: le unite nuove non aspettano P, e il controllo guardava le attese.
import { test, expect } from '@playwright/test';

const SCRIPT = await import('../../../scripts/claude-feedback.mjs');
const FB = globalThis.SN_FEEDBACK;

test('r1 una segnalazione già unita in un pacchetto aperto non entra in un altro', async () => {
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
  SCRIPT.ambiente.routine = () => false;
  const P = SCRIPT.pacchetto;
  const orig = { submit: FB.submit, leggi: P.leggi, allegati: P.allegati, attesiDa: P.attesiDa, archivia: P.archivia, sposta: P.sposta, log: console.log, err: console.error };
  const submit = [];
  const err = [];
  // #812 è rimasta in coda dopo il pacchetto #900 (aperto): il server le ha già scritto il rimando a #900.
  const voci = {
    812: { ok: true, id: 'id812', num: '812', stato: 'todo', priorita: 1, locale: false, attese: [], ramo: '', unisce: [], fidato: true, unitoIn: 'idP900' },
    815: { ok: true, id: 'id815', num: '815', stato: 'todo', priorita: 1, locale: false, attese: [], ramo: '', unisce: [], fidato: true },
    900: { ok: true, id: 'idP900', num: '900', stato: 'todo', priorita: 1, locale: false, attese: [], ramo: '', unisce: ['812', '813'], fidato: true },
  };
  FB.submit = async (payload, opts) => { submit.push({ payload, opts }); return { id: 'pacco2', seq: 950, senderProof: 'admin' }; };
  P.leggi = async (numeri) => numeri.map((n) => voci[String(n).replace(/^#/, '')] || Object.values(voci).find((v) => v.id === n) || { ok: false, num: n, motivo: `nessun feedback #${n}` });
  P.allegati = async () => [];
  P.attesiDa = async () => [];
  P.archivia = async () => ({ ok: true });
  P.sposta = async () => ({ ok: true });
  console.log = () => {};
  console.error = (...a) => err.push(a.join(' '));
  let code;
  try {
    code = await SCRIPT.main(['Secondo pacchetto', 'spec', '--non-locale', '--pacchetto', '812,815']);
  } finally {
    FB.submit = orig.submit; P.leggi = orig.leggi; P.allegati = orig.allegati; P.attesiDa = orig.attesiDa; P.archivia = orig.archivia; P.sposta = orig.sposta;
    console.log = orig.log; console.error = orig.err;
  }
  expect(submit, 'due pacchetti farebbero lo stesso lavoro su #812').toHaveLength(0);
  expect(code).not.toBe(0);
  expect(err.join('\n')).toMatch(/#812/);
});

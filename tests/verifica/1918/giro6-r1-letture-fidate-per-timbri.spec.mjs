// Verifica #1918 giro 6, rilievo 1: una sessione locale che legge testo fidato per un timbro (un feedback senza note
// d'altri, l'elenco dei compiti) non lo dice al server, che così non le lascia le radici: tolto il timbro resta fidata.
// Logica pura degli strumenti della sessione, senza Electron; la parte del server è nel suo ramo.
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RADICE = join(import.meta.dirname, '..', '..', '..');
const importa = (p) => import(pathToFileURL(join(RADICE, p)).href);

test('r1 la lettura di un feedback fidato per il timbro sul testo dell’utente lo nomina al server', async () => {
  const mod = await importa('scripts/leggi-feedback.mjs');
  const fields = {
    status: { stringValue: 'todo' }, name: { stringValue: 'Titolo' }, text: { stringValue: 'testo dell’utente' },
    clientId: { stringValue: 'anon-1' }, senderProof: { stringValue: '' }, fiducia: { stringValue: 'fidato' },
    seq: { integerValue: '40' }, notes: { stringValue: '' },
    radici: { arrayValue: { values: [{ stringValue: 'feedback:40' }] } },
  };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/f-40', fields }) });
  const esito = await mod.leggi('f-40', { bearer: 't', segno: 'k1', decifra: async (g) => ({ ...g }), fetchImpl });
  expect(esito.codice).toBe(0);
  const chiamate = [];
  await mod.rigaDellaLettura(esito, { riga: async (cosa, motivi, opts) => { chiamate.push(opts); return 'ok'; } });
  expect(chiamate.map((o) => o && o.letti), 'senza la lettura nominata, il timbro tolto su #40 non raggiunge la sessione').toEqual([[{ tipo: 'feedback', id: 'f-40' }]]);
});

test('r1 l’elenco dei compiti tutti fidati nomina al server anche quelli fidati per un timbro', async () => {
  const { esegui } = await importa('scripts/compito.mjs');
  const sporcate = [];
  const elenco = { ok: true, aperti: [
    { id: 'C-8', tipo: 'manuale', titolo: 'nato da #40, fidato col suo timbro', fiducia: 'fidato', stato: 'aperto', aperto: true, urgenza: 30, biglietti: [] },
  ], storico: [] };
  const sporca = async (cosa, motivi, opts = {}) => { sporcate.push(opts); return 'ok'; };
  expect(await esegui(['elenco'], { chiama: async () => elenco, bigliettoLocale: async () => 's', sporca, scrivi: () => {}, errore: () => {} })).toBe(0);
  expect(sporcate.flatMap((o) => (o && o.letti) || []), 'C-8 letto mentre era fidato per il timbro: il server deve saperlo').toContainEqual({ tipo: 'compito', id: 'C-8' });
});

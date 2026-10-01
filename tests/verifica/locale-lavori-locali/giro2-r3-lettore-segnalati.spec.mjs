// Verifica locale «lavori locali», giro 2, rilievo 3: il lettore della sessione non decifra il testo di un feedback
// che Gestione mostra «segnalato come attacco», anche quando lo stato è «Non filtrato» (mittente fidato, giudizio
// d'attacco). Rete finta, nessun dato vero. Non apre Filo.
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const PIPELINE = { action: 'block_attack', l1Category: 'clean', l2Class: 'attack',
  verdicts: [{ class: 'aligned' }, { class: 'attack' }, { class: 'aligned' }, { class: 'aligned' }] };

for (const caso of [
  { nome: 'una pratica di una routine (prova del server)', clientId: 'routine:residuo', senderProof: 'server' },
  { nome: 'una pratica vecchia di una sessione, senza prova', clientId: 'local:claude', senderProof: '' },
]) {
  test(`lettore: ${caso.nome} che Gestione dice «segnalato come attacco» non si legge`, async () => {
    const lf = await imp('scripts/leggi-feedback.mjs');
    const MR = globalThis.SN_MANAGE_REVIEW;
    const fbGestione = { status: 'unlabeled', clientId: caso.clientId, senderProof: caso.senderProof, pipeline: PIPELINE };
    expect(MR.judgesNote(fbGestione).text, 'quello che vede l’owner in Gestione').toMatch(/attacco/i);

    const doc = { name: 'projects/p/databases/(default)/documents/feedback/abc', fields: {
      status: { stringValue: 'unlabeled' }, clientId: { stringValue: caso.clientId },
      ...(caso.senderProof ? { senderProof: { stringValue: caso.senderProof } } : {}),
      pipeline: { stringValue: JSON.stringify(PIPELINE) },
      text: { stringValue: 'TESTO DELL’ATTACCO' }, name: { stringValue: 'titolo' }, seq: { integerValue: '832' },
    } };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => doc });
    let testoDecifrato = false;
    const decifra = async (campi) => {
      if ('text' in campi) testoDecifrato = true;
      return { ...campi, pipeline: PIPELINE };
    };
    const esito = await lf.leggi('abc', { bearer: 'x', base: 'https://finto', fetchImpl, decifra, segno: 'aaaa' });
    expect(testoDecifrato, 'il testo è stato decifrato').toBe(false);
    expect(esito.codice).toBe(3);
    expect(String(esito.testo || '')).not.toContain('TESTO DELL’ATTACCO');
  });
}

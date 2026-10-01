// Verifica locale «lavori locali», giro 6, rilievo 1: il lettore della sessione su un feedback dell'owner con una spec
// allegata e uno screenshot. La sessione deve sapere che ci sono e poterli leggere: oggi il lettore li tace.
// Rete finta: nessuna lettura né scrittura su Firestore vero.
import { test, expect } from './../../fixtures/electron.mjs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

test('il lettore dice alla sessione che il feedback ha una spec allegata e uno screenshot', async () => {
  const L = await imp('scripts/leggi-feedback.mjs');
  const doc = {
    name: 'projects/x/databases/(default)/documents/feedback/spec-1',
    fields: {
      clientId: { stringValue: 'owner:me' }, senderProof: { stringValue: 'admin' },
      status: { stringValue: 'todo' }, seq: { integerValue: '9601' },
      name: { stringValue: 'Profilo segreto (spec allegata)' },
      text: { stringValue: 'La spec completa è ALLEGATA a questo feedback: in caso di dubbio vale l’allegato.' },
      files: { arrayValue: { values: [{ mapValue: { fields: {
        url: { stringValue: 'https://firebasestorage.googleapis.com/v0/b/x/o/feedback%2Fspec' },
        name: { stringValue: 'profilo-segreto-spec.md' }, type: { stringValue: 'text/markdown' },
      } } }] } },
      images: { arrayValue: { values: [{ stringValue: 'https://firebasestorage.googleapis.com/v0/b/x/o/feedback%2Fshot' }] } },
    },
  };
  const fetchImpl = async () => new Response(JSON.stringify(doc), { status: 200 });
  const esito = await L.leggi('spec-1', { bearer: 'finto', base: 'https://finto', fetchImpl, decifra: async (f) => f, segno: 'abc123' });
  expect(esito.codice, esito.errore).toBe(0);
  // Il nome dell'allegato o almeno la sua esistenza: senza, la sessione lavora sul riassunto e ignora la spec che vale.
  expect(esito.testo).toMatch(/profilo-segreto-spec\.md|allegat/i);
  expect(esito.testo).toMatch(/immagin|screenshot/i);
});

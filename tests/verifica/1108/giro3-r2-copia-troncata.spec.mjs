// #1108 giro 3 — una copia dei feedback salvata a metà (le prime righe di una risposta lunga) è ancora una copia:
// il salvataggio e la sentinella devono riconoscerla anche se non è un JSON chiuso.
import { test, expect } from '@playwright/test';
import { motivoCopiaTesto } from '../../../scripts/lib/copie-di-dati.mjs';

const doc = (i) => ({
  name: `projects/p/databases/(default)/documents/feedback/id${i}`,
  fields: {
    text: { stringValue: `testo finto ${i}` },
    clientId: { stringValue: `cid-${i}` },
    userAgent: { stringValue: 'Mozilla/5.0 finto' },
    notes: { stringValue: 'x'.repeat(200) },
  },
});

test('r2 le prime righe di una risposta Firestore salvata a metà vengono riconosciute', () => {
  const intera = JSON.stringify({ documents: Array.from({ length: 50 }, (_, i) => doc(i)) }, null, 2);
  expect(motivoCopiaTesto(intera)).not.toBe('');
  const meta = intera.split('\n').slice(0, 300).join('\n');
  expect(motivoCopiaTesto(meta)).not.toBe('');
});

test('r2 un elenco di feedback in chiaro salvato a metà viene riconosciuto', () => {
  const lista = Array.from({ length: 50 }, (_, i) => ({ id: `id${i}`, text: `testo ${i}`, clientId: `cid-${i}`, userAgent: 'Mozilla/5.0' }));
  const intera = JSON.stringify(lista, null, 2);
  expect(motivoCopiaTesto(intera)).not.toBe('');
  expect(motivoCopiaTesto(intera.slice(0, intera.length / 2))).not.toBe('');
});

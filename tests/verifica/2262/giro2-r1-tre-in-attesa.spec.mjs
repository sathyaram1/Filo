// Verifica #2262 giro 2, rilievo 1: in Gestione una priorità 3 che la coda fa partire non sta fra quelli in attesa.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const m of ['feedbackTransitions', 'feedbackStatus', 'mittenti', 'feedbackAttese', 'manageReview']) require(`../../../src/shared/${m}.js`);

test('r1 una priorità 3 con l’attesa scritta dal manutentore sta in coda, non in attesa', () => {
  const MR = globalThis.SN_MANAGE_REVIEW;
  const aperto = { _id: 'aperto', status: 'todo' };
  const opts = { trovaAtteso: (id) => (id === 'aperto' ? aperto : undefined) };
  const fb = { _id: 'tre', status: 'todo', priority: 3, waitsFor: [{ id: 'aperto', num: '#1563', da: 'manutentore' }] };
  expect(MR.manageTabFor({ ...fb, priority: 2 }, opts), 'premessa: a priorità 2 la stessa attesa trattiene').toBe('waiting');
  expect(MR.manageTabFor(fb, opts), 'la coda la fa partire: in Gestione deve stare in coda').toBe('queue');
});

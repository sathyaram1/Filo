// Prove del giro 3 (verifica locale) sul lavoro «testi dei ruoli delle
// routine».
//
// Il giro di correzione è il passo che fa convergere una verifica: chi lo
// riceve ha in mano i rilievi e deve curarli. Qui si guarda la consegna
// COMPLETA di quel passo — quello che il dato dice (i rilievi da correggere)
// accanto a quello che il testo ordina — perché è insieme che arrivano a chi
// lavora, e se si contraddicono il giro si perde.

import { test, expect } from '@playwright/test';
import { buildPayload, readRoleInstructions, serialAwarenessNote } from '../../../scripts/dispatch.mjs';

const bucket = { role: 'fixer', branch: 'claude/x', id: 'abc', num: '700', serverCritique: '[2] il pulsante non salva', loopCount: 1 };
const ctx = { feedback: { text: 'non salva' }, history: ['prima critica', 'seconda critica'], historyDropped: 0 };

test('chi riceve i rilievi da correggere riceve anche le istruzioni per correggerli', () => {
  const dato = buildPayload(bucket, ctx);
  // La consegna porta davvero una correzione: il caso, la critica, la serie.
  expect(dato.case).toBe('correzione');
  expect(dato.verifierCritique).toBeTruthy();

  const testo = readRoleInstructions(bucket.role);
  // …quindi il testo non può dichiarare il contrario di quello che c'è da fare.
  expect(testo, 'a chi deve correggere viene detto che non è una correzione')
    .not.toMatch(/non è una correzione/i);
  expect(testo, 'a chi deve correggere viene vietato di cambiare il comportamento')
    .not.toMatch(/Non migliorare, non ritoccare, non aggiungere/);
  // E porta con sé i criteri con cui il lavoro verrà giudicato al giro dopo.
  expect(testo, 'chi corregge non riceve i criteri con cui sarà rigiudicato')
    .toContain('1. **La lamentela.**');
});

test('le istruzioni accodate alla correzione non contraddicono il testo del ruolo', () => {
  const testo = readRoleInstructions(bucket.role);
  const coda = serialAwarenessNote(bucket.role, ctx.history, 0);
  // La coda ordina di rileggere le critiche e di curare la causa: se il testo
  // sopra vieta di toccare qualunque cosa, le due metà si annullano.
  expect(coda).toMatch(/Leggile TUTTE prima di toccare codice/);
  expect(`${testo}\n\n${coda}`, 'il testo vieta proprio ciò che la coda ordina')
    .not.toMatch(/ogni riga cambiata oltre il conflitto/);
});

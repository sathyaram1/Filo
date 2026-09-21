// Prove del giro 3 (verifica locale) sul lavoro «testi dei ruoli delle
// routine».
//
// La rete lasciata dai giri passati guarda le frasi copiate parola per parola.
// Una regola riscritta con altre parole passa sotto quella rete e divide lo
// stesso danno: due copie che qualcuno corregge una alla volta. Qui si guarda
// il testo COMPOSTO, cioè quello che arriva davvero a chi lavora, e si conta
// quante volte la stessa regola viene spiegata dentro un solo testo.

import { test, expect } from '@playwright/test';
import { readRoleInstructions } from '../../../scripts/dispatch.mjs';

// Quante volte un testo spiega (non solo cita) come si porta all'owner una
// scelta che non spetta a chi lavora: il segno è il posto dove l'owner la apre.
const spiegazioniDelRombo = (t) => (t.match(/rombo/g) || []).length;

test('la regola sul trade-off da portare all\'owner è spiegata una volta sola', () => {
  for (const ruolo of ['verifier', 'new-work', 'fixer', 'secaudit']) {
    expect(spiegazioniDelRombo(readRoleInstructions(ruolo)), `il ruolo ${ruolo} la spiega più di una volta`)
      .toBeLessThanOrEqual(1);
  }
});

test('la regola sul testo di ritorno che nessuno legge è scritta una volta sola', () => {
  for (const ruolo of ['verifier', 'new-work', 'fixer', 'secaudit', 'prober']) {
    const n = (readRoleInstructions(ruolo).match(/testo di ritorno/gi) || []).length;
    expect(n, `il ruolo ${ruolo} la ripete ${n} volte`).toBeLessThanOrEqual(1);
  }
});

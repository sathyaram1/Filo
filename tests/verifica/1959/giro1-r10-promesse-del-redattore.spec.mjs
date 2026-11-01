// Verifica #1959 giro 1: una promessa del redattore su un lavoro che non è nella rosa né a priorità 3 si rifiuta anche
// quando è scritta con parole comuni diverse da «in arrivo».
import { test, expect } from '@playwright/test';
import { controllaNovita } from '../../../scripts/manutentore.mjs';

const blocco = { version: '0.2.255', features: [{ testo: 'Le schede si trascinano fra le finestre.' }], fixes: [] };
const schede = [{ num: '812', priorita: 2, titolo: 'Allegati docx' }, { num: '900', priorita: 1, titolo: 'Formati audio' }];

for (const riga of [
  'Il supporto per i formati audio arriverà con il prossimo aggiornamento.',
  'Nella prossima versione: i formati audio.',
  'Stiamo preparando il supporto per i formati audio.',
  'In futuro anche i formati audio.',
]) {
  test(`r10 promessa non dichiarata rifiutata: ${riga}`, () => {
    const c = controllaNovita({ versione: '0.2.255', features: ['Le schede si trascinano fra le finestre.', riga], fixes: [] }, { blocco, schede });
    expect(c.ok).toBe(false);
  });
}

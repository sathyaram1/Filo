// Prova del giro 1: la via d'uscita di chi riceve un lavoro ambiguo.
//
// Il testo di chi fa il primo lavoro dice di fermarsi e chiedere, e nomina il
// contrassegno da usare — ma non il comando con cui si fa. Tutte le altre
// uscite dello stesso testo (consegna, segnalazione all'owner, rilascio) hanno
// il loro comando scritto per esteso. Chi ha in mano il lavoro deve indovinare
// proprio nel momento in cui non deve indovinare.

import { test, expect } from '@playwright/test';
import { readRoleInstructions } from '../../../scripts/dispatch.mjs';

test('chiedere invece di indovinare: il testo dice anche come si fa', () => {
  const primo = readRoleInstructions('new-work');
  expect(primo, 'la via d\'uscita non c\'è più: questa prova va riscritta').toContain('--reason clarify');

  // Il comando che porta quel contrassegno deve stare nello stesso testo.
  const righeComando = primo.split('\n').filter((r) => r.includes('node scripts/'));
  expect(righeComando.some((r) => r.includes('--reason')),
    'nessun comando nel testo porta il contrassegno per chiedere').toBe(true);
});

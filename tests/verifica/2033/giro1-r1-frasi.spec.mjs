// #2033 giro 1: alla nascita di un pacchetto, una spec rimandata alle note o un prerequisito scritto solo nel testo
// vanno rifiutati anche con le frasi più comuni, non solo con quelle del caso #1750.
import { test, expect } from '@playwright/test';
import { difettiDellaSpec } from '../../../scripts/lib/spec-del-pacchetto.mjs';

const UNITE = { unite: ['812', '815'], aspetta: [] };

test('r1 una spec mandata alle note con un altro verbo non passa', () => {
  for (const testo of [
    'Pacchetto di #812 e #815: vedere le note.',
    'Pacchetto #812, #815. Leggere le note del feedback.',
    '#812 e #815: consulta le note per la spec.',
    '#812 e #815. Tutto nelle note.',
  ]) {
    expect(difettiDellaSpec(testo, UNITE).join('\n'), testo).toMatch(/note/);
  }
});

test('r1 un prerequisito scritto senza «prima» non passa senza attesa', () => {
  for (const testo of [
    'Spec: #812 cambia X, #815 cambia Y. Da lavorare solo dopo #1202.',
    'Spec: #812 cambia X, #815 cambia Y. Partire quando #1202 è fuso.',
    'Spec: #812 cambia X, #815 cambia Y. #1202 deve essere già fuso.',
  ]) {
    expect(difettiDellaSpec(testo, UNITE).join('\n'), testo).toMatch(/#1202/);
  }
});

// #2033 giro 2: il controllo alla nascita di un pacchetto riconosce un elenco di frasi; quelle vicine passano ancora.
import { test, expect } from '@playwright/test';
import { difettiDellaSpec } from '../../../scripts/lib/spec-del-pacchetto.mjs';

const UNITE = { unite: ['812', '815'], aspetta: [] };
const SPEC = 'Spec: #812 cambia X e si prova con Y, #815 cambia Z e si prova con W. ';

test('r1 una spec mandata alle note con parole comuni non passa', () => {
  for (const frase of ['Rimando alle note per la spec.', 'Le note contengono la spec.', 'Dettagli: note.']) {
    expect(difettiDellaSpec(SPEC + frase, UNITE).join('\n'), frase).toMatch(/note/);
  }
});

test('r1 un prerequisito scritto con parole comuni non passa senza attesa', () => {
  for (const frase of [
    'Dopo #1202.',
    'Va fatto dopo #1202.',
    'Non iniziare prima che #1202 sia fuso.',
    'Bloccato da #1202.',
    'Requisito: #1202 su main.',
    'Dipendenza: #1202.',
  ]) {
    expect(difettiDellaSpec(SPEC + frase, UNITE).join('\n'), frase).toMatch(/#1202/);
  }
});

// Prove del giro 3 (verifica locale) sul lavoro «testi dei ruoli delle
// routine».
//
// La consegna di un caso e il testo che lo accompagna devono dire la stessa
// cosa. Il caso che riallinea un ramo dopo un conflitto riceve un testo che
// vieta di cambiare qualunque riga oltre al conflitto: se nella stessa busta
// arrivassero dei rilievi da correggere, chi lavora leggerebbe un'intestazione
// che dice il contrario di quello che ha in mano, e il giro si perderebbe.

import { test, expect } from '@playwright/test';
import { buildPayload, checkEnvelope, readRoleInstructions, serialAwarenessNote } from '../../../scripts/dispatch.mjs';

const feedback = { text: 'non salva' };
const storia = ['prima critica', 'seconda critica'];

test('il riallineamento dopo un conflitto non riceve niente da correggere', () => {
  const dato = buildPayload(
    { role: 'fixer', branch: 'claude/x', id: 'abc', num: '700', serverCritique: '[2] il pulsante non salva' },
    { feedback, history: storia, historyDropped: 0 },
  );
  expect(dato.case).toBe('riallineamento');
  expect(dato.verifierCritique, 'la consegna porta rilievi a chi non deve toccarli').toBeUndefined();
  expect(dato.history, 'la serie delle critiche serve a chi corregge, non a chi riallinea').toBeUndefined();
});

test('niente istruzioni accodate che ordinino il contrario del testo di ruolo', () => {
  const testo = readRoleInstructions('fixer');
  const coda = serialAwarenessNote('fixer', storia, 0);
  expect(testo).toMatch(/Non migliorare, non ritoccare, non aggiungere/);
  expect(coda, 'al riallineamento viene ordinato di rileggere le critiche e curare la causa').toBe('');
});

test('una busta di riallineamento con dentro una critica ferma il giro', () => {
  const busta = {
    role: 'fixer', id: 'abc', num: '700', branch: 'claude/x',
    payload: { role: 'fixer', feedback, critique: '[2] il pulsante non salva' },
  };
  expect(checkEnvelope(busta), 'passa, e chi la riceve fa il lavoro sbagliato senza che si veda').toBeTruthy();
  // Senza la critica la stessa busta è un lavoro buono.
  expect(checkEnvelope({ ...busta, payload: { role: 'fixer', feedback } })).toBeNull();
});

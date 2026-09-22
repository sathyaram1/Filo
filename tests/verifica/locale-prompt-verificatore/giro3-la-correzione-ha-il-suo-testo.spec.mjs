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

test('il riallineamento arriva SEMPRE con la critica del server, e si lavora lo stesso', () => {
  // Il server scrive una critica sua a ogni conflitto di fusione («va
  // RIALLINEATO il ramo»): una guardia che ferma la busta perché «c'è una
  // critica» fermerebbe tutti i riallineamenti.
  const busta = {
    role: 'fixer', id: 'abc', num: '700', branch: 'claude/x',
    payload: { role: 'fixer', feedback, critique: 'FAIL tecnico, non di qualità: la fusione su main è fallita per un CONFLITTO' },
  };
  expect(checkEnvelope(busta)).toBeNull();
});

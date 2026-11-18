// #2498 giro 1: nel motivo di un conflitto le parole di una nota non sono file di codice, anche fuori dalle tonde.
// Esito accettato: la nota resta fuori dall'elenco dei file, oppure il motivo è rifiutato dicendo cosa non va.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/verifierRound.js');
const R = globalThis.SN_VERIFIER_ROUND;

const SERVIZIO = ['src/shared/patchNotes.js', 'PATTERNS.md'];

test('r1 una nota scritta senza tonde non diventa file di codice né un giro di verifica in più', () => {
  for (const motivo of [
    'conflitto: src/shared/patchNotes.js, PATTERNS.md nel ramo del server',
    'conflitto: src/shared/patchNotes.js, PATTERNS.md, ramo del server',
    'conflitto: src/shared/patchNotes.js, PATTERNS.md [ramo del server]',
    'conflitto: src/shared/patchNotes.js e PATTERNS.md',
    'conflitto: src/shared/patchNotes.js, PATTERNS.md (ramo (main) del server)',
  ]) {
    const r = R.leggiMotivoCorrettore(motivo);
    if (!r.ok) continue;
    expect(r.motivo.file, motivo).toEqual(SERVIZIO);
    expect(R.giroDopoRiallineamento([], { conflitti: r.motivo.file }).giro, motivo).toBe('nessuno');
  }
});

test('r1 la nota di un motivo dato come oggetto torna uguale anche con le tonde dentro', () => {
  const m = { tipo: 'conflitto', file: SERVIZIO, testo: 'ramo del server (main)' };
  const r = R.leggiMotivoCorrettore(R.testoMotivo(m));
  expect(r.ok).toBe(true);
  expect(r.motivo.file).toEqual(SERVIZIO);
});

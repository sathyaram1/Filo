// Prove del giro 2 (verifica locale) sul lavoro «seguito del giro», punto 3:
// le decisioni dell'owner che il server mette nel payload (`decisioni`)
// devono arrivare nel compito che dispatch consegna a chi verifica, risolve e
// corregge. Si prova la stessa catena del cloud: busta del server →
// serverCtx → buildPayload (quello che emit stampa al lavoratore).

import { test, expect } from '@playwright/test';
import { serverCtx, buildPayload } from '../../../scripts/dispatch.mjs';

const DECISIONI = [
  { domanda: 'Il riquadro va a destra o a sinistra?', risposta: 'A destra, come nelle altre pagine.' },
  { domanda: 'Tengo anche la scorciatoia?', risposta: 'Sì.' },
];

function compito(role, extra = {}) {
  const bucket = { role, id: 'fb1', num: '#700', branch: 'claude/fb-700' };
  const fromServer = {
    payload: {
      role,
      branch: 'claude/fb-700',
      feedback: { text: '«Sposta il riquadro»', num: '#700' },
      history: [],
      decisioni: DECISIONI,
      ...extra,
    },
  };
  return buildPayload(bucket, serverCtx(bucket, fromServer));
}

test.describe('decisioni dell\'owner — arrivano nel compito del lavoratore in cloud', () => {
  test('chi verifica le riceve', () => {
    expect(compito('verifier').decisioni).toEqual(DECISIONI);
  });

  test('chi risolve un lavoro nuovo le riceve', () => {
    expect(compito('new-work').decisioni).toEqual(DECISIONI);
  });

  test('chi riprende e corregge dopo una risposta dell\'owner le riceve tutte, non solo l\'ultima', () => {
    const p = compito('fixer', { ripresa: { domanda: 'Tengo anche la scorciatoia?', risposta: 'Sì.', rilievi: [], ruolo: 'verifier' } });
    expect(p.case).toBe('ripresa');
    expect(p.decisioni).toEqual(DECISIONI);
  });
});

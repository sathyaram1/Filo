// #2217 giro 2, rilievo 1: aperto dalla sessione locale col segno lavoro server ma non fidato, lo strumento non deve
// promettere che lo prendono le routine dei lavori server: nessuna lo prende finché l'owner non lo rende fidato.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedbackThread.js'));

test('r1 --server senza biglietto valido: l’annuncio non dice che lo prendono le routine', async () => {
  const SCRIPT = await import('../../../scripts/claude-feedback.mjs');
  const FB = globalThis.SN_FEEDBACK;
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
  SCRIPT.ambiente.routine = () => false;
  const origSubmit = FB.submit;
  FB.submit = async (_p, o) => ({ id: 'd12', seq: 912, senderProof: 'admin', localOnly: !!o.localOnly });
  const righe = [];
  const origLog = console.log;
  console.log = (...a) => righe.push(a.join(' '));
  try {
    expect(await SCRIPT.main(['Regola del server', 'Tutto in functions/src.', '--non-locale', '--server'])).toBe(SCRIPT.EXIT.FATTO);
  } finally {
    console.log = origLog;
    FB.submit = origSubmit;
  }
  const testo = righe.join('\n');
  expect(testo).toMatch(/non fidato/);
  expect(testo, 'nessuna routine prende un lavoro server non fidato').not.toMatch(/lo prendono le routine/);
});

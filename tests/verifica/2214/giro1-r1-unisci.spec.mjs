// Verifica #2214 giro 1: sul cancello di oggi la riga che il server legge la scrive l'unione delle parti Linux e
// Windows; se lì il campo delle novità si perde, il server non sa che basta spostarle e rimanda in correzione.
import { test, expect } from '@playwright/test';

const RAMO = 'a'.repeat(40);
const MAIN = 'b'.repeat(40);
const ROSSO = 'src/shared/patchNotes.js › una riga del ramo sotto versioni già uscite (0.2.266): vanno nel blocco 0.2.267';
const NOVITA = { verso: '0.2.267', dopo: 'verde', righe: [{ version: '0.2.266', riga: 'Schede dalla chat' }] };
const parte = (nome, campo) => ({ nome, risultato: 'success', campo: JSON.stringify({ ramo: RAMO, main: MAIN, ...campo }) });

async function unisci() {
  const m = await import('../../../scripts/unit-fusione-azione.mjs');
  expect(typeof m.unisciParti, 'la corsa del cancello unisce le parti Linux e Windows').toBe('function');
  return m.unisciParti;
}

test('r1 solo Linux acceso: la riga unita porta al server che basta spostare le novità', async () => {
  const unisciParti = await unisci();
  const riga = unisciParti({ ramo: RAMO, main: MAIN, parti: [
    parte('linux', { esito: 'rosso_sulla_fusione', mainSha: MAIN, rossi: [ROSSO], novita: NOVITA }),
    { nome: 'windows', risultato: 'skipped', campo: '' },
  ] });
  expect(riga.esito).toBe('rosso_sulla_fusione');
  expect(riga.novita && riga.novita.dopo, JSON.stringify(riga)).toBe('verde');
});

test('r1 Linux e Windows rossi solo per le novità: la riga unita dice ancora che basta spostarle', async () => {
  const unisciParti = await unisci();
  const riga = unisciParti({ ramo: RAMO, main: MAIN, parti: [
    parte('linux', { esito: 'rosso_sulla_fusione', mainSha: MAIN, rossi: [ROSSO], novita: NOVITA }),
    parte('windows', { esito: 'rosso_sulla_fusione', mainSha: MAIN, rossi: [ROSSO], novita: NOVITA }),
  ] });
  expect(riga.novita && riga.novita.dopo, JSON.stringify(riga)).toBe('verde');
});

test('r1 un rosso vero su Windows oltre alle novità: la riga unita non dice che basta spostarle', async () => {
  const unisciParti = await unisci();
  const riga = unisciParti({ ramo: RAMO, main: MAIN, parti: [
    parte('linux', { esito: 'rosso_sulla_fusione', mainSha: MAIN, rossi: [ROSSO], novita: NOVITA }),
    parte('windows', { esito: 'rosso_sulla_fusione', mainSha: MAIN, rossi: [ROSSO, 'tests/unit/x.test.mjs › y'], novita: { ...NOVITA, dopo: 'rosso_sulla_fusione' } }),
  ] });
  expect(riga.esito).toBe('rosso_sulla_fusione');
  expect(Boolean(riga.novita) && ['verde', 'rosso_anche_su_main'].includes(riga.novita.dopo), JSON.stringify(riga)).toBe(false);
});

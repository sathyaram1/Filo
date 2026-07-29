// Feedback #359: l'utente vuole poter chiedere a Filo IN CHAT quanti crediti gli
// restano, senza aprire la pagina Crediti. La chat passa a Filo il "Filo State"
// come contesto: perché Filo possa rispondere col saldo, quel testo DEVE
// contenere il saldo corrente.
//
// Questo spec esercita il vero percorso nel processo main (assemble() → motore
// crediti → testo del prompt) e asserisce il SUCCESSO: dopo aver consumato dei
// crediti, il testo di stato che Filo riceve riporta il saldo aggiornato.
//
// Senza il fix, assemble() non guardava i crediti: il testo non conteneva né la
// sezione CREDITI né il saldo → gli assert su "CREDITI" e sul numero diventano rossi.

import { test, expect } from './fixtures/electron.mjs';

test('il Filo State passato alla chat contiene il saldo crediti aggiornato', async ({ app }) => {
  // Il bonus giornaliero "feedback autonomo" (+10) altererebbe il saldo atteso:
  // lo spegniamo così il saldo riflette SOLO il consumo che seminiamo.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ security: { autoFeedback: false } });
  });

  // Consumo di 100 crediti (0,08€ / 0,0008€ = 100): saldo atteso 1000 - 100 = 900.
  await app.evaluate(async () => {
    await globalThis.SN_CREDITS.recordConsumption({ action: 'filo_chat', costEur: 0.08 });
  });

  const stateText = await app.evaluate(async () => {
    const { stateText } = await globalThis.SN_FILO_STATE.assemble();
    return stateText;
  });

  expect(stateText).toMatch(/CREDITI/);
  expect(stateText).toMatch(/900/);
});

// #602 — UNA SEGNALAZIONE BUTTATA VIA DEVE ESSERE DETTA, E VISTA.
//
// «Invia» non aspetta la rete: il riquadro si chiude subito, chi ha scritto
// legge «Grazie! Feedback inviato» e prende i crediti, e la segnalazione parte
// dopo, dalla coda. Se nel frattempo la cifratura non si può più fare, quella
// segnalazione non partirà mai: riprovare non cambia niente finché la copia di
// Filo resta com'è. L'unica cosa che le resta è l'avviso.
//
// L'avviso viaggiava come quelli delle pagine, che una pagina mostra SOLO se in
// quel momento è davanti e a fuoco: con Filo in secondo piano, su una pagina
// interna o appena avviato non lo vedeva nessuno, e la segnalazione spariva in
// silenzio lo stesso. Adesso compare nella cornice della finestra e ci resta
// finché non lo si chiude.
//
// Senza il fix questo spec è rosso: nella cornice non compare niente.

import { test, expect } from './fixtures/electron.mjs';

const MOTIVO = 'Non ho mandato niente: manca la chiave con cui si cifra. '
  + 'Senza cifratura quel contenuto lo può leggere chiunque.';

test('la segnalazione che non può partire lo dice nella finestra, e ci resta', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });

  // La copia di Filo che non riesce più a cifrare, con una segnalazione già in
  // coda: è lo stato in cui, prima, la voce spariva senza una parola.
  const esito = await app.evaluate(async ({ }, motivo) => {
    const OB = globalThis.SN_FEEDBACK_OUTBOX;
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__submitVero = FB.submit;
    FB.submit = async () => {
      const e = new Error(motivo);
      e.cifratura = true;
      throw e;
    };
    await OB.enqueue({ submissionId: 'prova-602-avviso', text: 'il pulsante non risponde' });
    await OB.flush();
    return { inCoda: OB.size() };
  }, MOTIVO);

  // Chi ha mandato la segnalazione lo legge: nella cornice della finestra,
  // senza dover avere una pagina davanti.
  const avviso = shell.locator('.shell-notif').filter({ hasText: /non ho mandato niente/i });
  await expect(avviso).toHaveCount(1, { timeout: 10_000 });
  await expect(avviso).toContainText(/chiave|cifrat/i);

  // Non se ne va da solo: è una cosa da rimandare, non un messaggio di passaggio.
  await shell.waitForTimeout(1500);
  await expect(avviso).toHaveCount(1);
  // E si chiude quando lo decide chi legge.
  await avviso.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 5_000 });

  // Detta la cosa, la voce esce dalla coda: non resta lì a ritentare per niente.
  expect(esito.inCoda, 'avvisato qualcuno, la voce non serve più').toBe(0);

  await app.evaluate(async () => {
    const FB = globalThis.SN_FEEDBACK;
    if (globalThis.__submitVero) FB.submit = globalThis.__submitVero;
  });
});

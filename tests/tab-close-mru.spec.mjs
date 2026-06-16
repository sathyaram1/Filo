// Chiusura tab → torna alla PENULTIMA tab vista (MRU), non a quella a sinistra.
//
// Feedback: "quando chiudo una tab voglio che mi riporti alla penultima tab che
// stavo guardando (adesso semplicemente mi riporta a quella a sinistra)".
//
// Asseriamo il COMPORTAMENTO: dopo aver visitato A→B→C→D e poi essere tornati
// su B, chiudere B deve riportare su D (l'ultima vista prima di B), NON su C
// (la tab adiacente a sinistra/destra nell'ordine della barra).

import { test, expect } from './fixtures/electron.mjs';

test('chiudere la tab attiva riporta alla penultima vista, non all’adiacente', async ({ shell }) => {
  // Apre quattro tab interne distinte; ognuna si attiva all'apertura.
  const ids = await shell.evaluate(async () => {
    const open = async (u) => (await window.filoShell.tabs.open(u)).id;
    return {
      A: await open('filo://history/history.html'),
      B: await open('filo://security/security.html'),
      C: await open('filo://options/options.html'),
      D: await open('filo://feedback/feedback.html'),
    };
  });

  // Stato: l'ultima aperta (D) è attiva. Torniamo a guardare B.
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), ids.B);
  await expect
    .poll(() => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId))
    .toBe(ids.B);

  // Chiudiamo B (attiva). La penultima vista prima di B era D.
  await shell.evaluate((id) => window.filoShell.tabs.close(id), ids.B);

  const activeId = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  // MRU corretto: D. (Il vecchio comportamento "tab a sinistra" darebbe C.)
  expect(activeId).toBe(ids.D);
  expect(activeId).not.toBe(ids.C);
});

test('fallback all’adiacente se nessuna tab rimasta è mai stata vista a fondo', async ({ shell }) => {
  // Apre due tab in background (activate:false) oltre a quella attiva: non
  // hanno mai ricevuto un'attivazione, quindi alla chiusura si ripiega
  // sull'adiacente senza esplodere.
  const ids = await shell.evaluate(async () => {
    const cur = (await window.filoShell.tabs.snapshot()).activeId;
    // apri due tab attivandole in sequenza, poi torna sulla prima aperta
    const A = (await window.filoShell.tabs.open('filo://history/history.html')).id;
    const B = (await window.filoShell.tabs.open('filo://security/security.html')).id;
    return { cur, A, B };
  });

  // B è attiva. Chiuderla deve riportare su A (l'unica altra vista).
  await shell.evaluate((id) => window.filoShell.tabs.close(id), ids.B);
  const activeId = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  expect(activeId).toBe(ids.A);
});

// Feedback alpha: "sposta nuova finestra in incognito da impostazioni ad
// account".
//
// La voce "Nuova finestra incognito" stava nel menu Impostazioni (icona
// ingranaggio). L'utente l'ha chiesta nel menu dell'account (icona profilo).
// Il fix la rimuove dal menu Impostazioni e la aggiunge al menu account, sia da
// loggato sia da sloggato (così resta sempre raggiungibile anche senza login).
//
// Il menu è un BrowserWindow nativo aperto via `filoShell.popupMenu(entries,…)`:
// `filoShell` è esposto con contextBridge (read-only, non si può spiare). Quindi
// clicchiamo il bottone reale e leggiamo il CONTENUTO del popup nativo, che è
// costruito da popup-menu.js a partire dalle `entries` che shell.js passa: così
// testiamo l'intera catena (shell.js → ipc → popup).
//
// Prima del fix: il popup di Impostazioni conteneva "Nuova finestra incognito" e
// quello dell'account no → entrambe le asserzioni fallirebbero.

import { test, expect } from './fixtures/electron.mjs';

// Clicca un bottone della shell e ritorna il testo del popup-menu nativo aperto.
async function openMenuText(app, shell, btnId) {
  // Chiudi eventuali popup residui dando focus alla shell.
  await shell.bringToFront().catch(() => {});
  // I bottoni della barra sono ora trigger interni nascosti (le icone visibili
  // sono dentro la home): li azioniamo con un click DOM diretto, come il bridge.
  await shell.evaluate((id) => document.getElementById(id).click(), btnId);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const popup = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (popup) {
      try {
        await popup.waitForSelector('.menu', { timeout: 1000 });
        const txt = await popup.locator('.menu').innerText();
        if (txt && txt.trim()) return txt;
      } catch (_) { /* popup chiuso/non pronto: ritenta */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`popup non aperto/leggibile per #${btnId}`);
}

test('menu account contiene "Nuova finestra incognito" (da sloggato)', async ({ app, shell }) => {
  // Nei test non c'è sessione Google → accountBtn è in stato sloggato.
  const txt = await openMenuText(app, shell, 'nav-account');
  expect(txt, 'manca "Nuova finestra incognito" nel menu account').toContain('Nuova finestra incognito');
  // Da sloggato il menu offre anche l'accesso.
  expect(txt, 'manca "Accedi" nel menu account sloggato').toContain('Accedi con Google');
});

test('menu Impostazioni NON contiene più "Nuova finestra incognito"', async ({ app, shell }) => {
  const txt = await openMenuText(app, shell, 'nav-settings');
  // Sanity: è davvero il menu Impostazioni (contiene "Preferenze").
  expect(txt, 'non sembra il menu Impostazioni').toContain('Preferenze');
  expect(txt, 'incognito è ancora nel menu Impostazioni: non è stato spostato').not.toContain('incognito');
});

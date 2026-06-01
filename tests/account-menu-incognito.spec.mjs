// Feedback alpha: "sposta nuova finestra in incognito da impostazioni ad
// account".
//
// La voce "Nuova finestra incognito" stava nel menu Impostazioni (icona
// ingranaggio). L'utente l'ha chiesta nel menu dell'account (icona profilo).
// Il fix la rimuove dal menu Impostazioni e la aggiunge al menu account, sia da
// loggato sia da sloggato (così resta sempre raggiungibile anche senza login).
//
// Il menu è un BrowserWindow nativo aperto via `filoShell.popupMenu(entries,…)`;
// pilotarne il popup live è race-prone (il blur lo chiude). Qui intercettiamo
// le `entries` che la shell passa a popupMenu cliccando i bottoni reali: così
// testiamo esattamente cosa costruisce shell.js.
//
// Prima del fix: il menu Impostazioni conteneva open-incognito e il menu
// account no → entrambe le asserzioni fallirebbero.

import { test, expect } from './fixtures/electron.mjs';

// Sostituisce filoShell.popupMenu con uno spy che registra le entries e NON
// apre il popup nativo. Poi clicca il bottone e ritorna le entries catturate.
async function captureMenu(shell, btnId) {
  return shell.evaluate(async (id) => {
    return await new Promise((resolve) => {
      const orig = window.filoShell.popupMenu;
      window.filoShell.popupMenu = (entries) => {
        window.filoShell.popupMenu = orig; // ripristina
        resolve(entries);
        return Promise.resolve({ ok: true });
      };
      document.getElementById(id).click();
      // Se per qualche motivo non chiama popupMenu (es. login diretto), sblocca.
      setTimeout(() => resolve(null), 1500);
    });
  }, btnId);
}

function hasAction(entries, action) {
  return Array.isArray(entries) && entries.some((e) => e && e.action === action);
}

test('menu account contiene "Nuova finestra incognito" (da sloggato)', async ({ shell }) => {
  // Nei test non c'è sessione Google → accountBtn è in stato sloggato.
  const entries = await captureMenu(shell, 'nav-account');
  expect(entries, 'il click sull\'account non ha aperto un menu').not.toBeNull();
  expect(hasAction(entries, 'open-incognito'), 'manca "Nuova finestra incognito" nel menu account').toBe(true);
  // Da sloggato il menu offre anche l'accesso.
  expect(hasAction(entries, 'auth-signin'), 'manca "Accedi" nel menu account sloggato').toBe(true);
});

test('menu Impostazioni NON contiene più "Nuova finestra incognito"', async ({ shell }) => {
  const entries = await captureMenu(shell, 'nav-settings');
  expect(entries, 'il click su Impostazioni non ha aperto un menu').not.toBeNull();
  expect(hasAction(entries, 'open-incognito'), 'incognito è ancora nel menu Impostazioni: non è stato spostato').toBe(false);
});

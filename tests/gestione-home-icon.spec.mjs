// Icona "Gestione" nella home (feature #366.1) — gate owner.
//
// L'icona/menu "Gestione" (pagine di sola-amministrazione) vive nella barra dei
// controlli in alto a destra della home, ma deve comparire SOLO all'owner. Qui
// verifichiamo il gate dal lato home:
//   - da NON owner (nessuna sessione admin) l'icona Gestione non è nel DOM;
//   - stubbando lo stato auth come admin e ridisegnando i controlli, l'icona
//     Gestione compare (con data-command="manage").
//
// Lo stato admin reale (sessione Google) non è automatizzabile in headless, così
// lo forziamo intercettando la risposta a `auth_status` — è il vero segnale che
// la home usa per decidere il gate.

import { test, expect } from './fixtures/electron.mjs';

const HOME = 'filo://newtab/';

test('home: da non-owner l\'icona Gestione non compare', async ({ openTab }) => {
  const page = await openTab(HOME);
  await page.waitForSelector('#dashControls .dash-ctrl', { timeout: 8000 });
  // Sanity: gli altri controlli ci sono (Impostazioni/App/Profilo).
  await expect(page.locator('#dashControls [data-command="settings"]')).toHaveCount(1);
  await expect(page.locator('#dashControls [data-command="manage"]')).toHaveCount(0);
});

test('home: da owner l\'icona Gestione compare tra i controlli', async ({ openTab }) => {
  const page = await openTab(HOME);
  await page.waitForSelector('#dashControls .dash-ctrl', { timeout: 8000 });

  // Intercetta la risposta a `auth_status` per simulare l'owner loggato, poi
  // ridisegna i controlli: la home rilegge lo stato auth e mostra il gate.
  await page.evaluate(() => {
    const orig = window.chrome.runtime.sendMessage;
    window.chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === 'auth_status') {
        const r = { ok: true, signedIn: true, isAdmin: true, profile: { email: 'owner@example.com', name: 'Owner' }, uid: 'owner' };
        if (typeof cb === 'function') { cb(r); return; }
        return Promise.resolve(r);
      }
      return orig(msg, cb);
    };
    window.__dashTest.renderControls();
  });

  await expect(page.locator('#dashControls [data-command="manage"]')).toHaveCount(1, { timeout: 5000 });
  // L'icona porta l'etichetta "Gestione".
  await expect(page.locator('#dashControls [data-command="manage"]')).toHaveAttribute('aria-label', 'Gestione');
});

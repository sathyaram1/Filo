// Cablaggio del login "Accedi con Google" nella shell (NON il round-trip live,
// che richiede il consenso Google in un browser reale e non è automatizzabile).
//
// Cosa verifichiamo end-to-end (preload → IPC → main → google-auth):
//   - il pulsante account esiste nella barra indirizzi della shell;
//   - l'API filoShell.auth è esposta e auth.status() risponde con la forma
//     attesa { ok, signedIn:false, profile:null } su userData pulito (nessuna
//     sessione persistita) — gira nel main process, i token non toccano il
//     renderer;
//   - cliccando il pulsante da sloggato si apre il menu account; da lì la voce
//     "Accedi con Google" avvia il login in una scheda di Filo, su pagine
//     d'accesso finte.

import { test, expect } from './fixtures/electron.mjs';
import { googleFinto, indirizzoDellAccesso } from './helpers/googleFinto.mjs';

test('shell: il pulsante account esiste come trigger interno del menu', async ({ shell }) => {
  // La barra in alto è stata rimossa: l'utente apre l'account dall'icona DENTRO
  // la home, che aziona questo bottone via MSG.SHELL_ACTION. Il bottone resta
  // quindi nel DOM (trigger interno) ma non è più visibile nella shell.
  await expect(shell.locator('#nav-account')).toBeAttached({ timeout: 8_000 });
  await expect(shell.locator('#nav-account')).toBeHidden();
});

test('auth.status() risponde dal main: sloggato su userData pulito', async ({ shell }) => {
  const status = await shell.evaluate(() => window.filoShell.auth.status());
  expect(status).toBeTruthy();
  expect(status.ok).toBe(true);
  expect(status.signedIn).toBe(false);
  expect(status.profile).toBeNull();
});

test('"Accedi con Google" dal menu account avvia il login in una scheda di Filo (#1123)', async ({ shell, app, testServer }) => {
  // Le pagine d'accesso sono finte (helpers/googleFinto.mjs): asseriamo che il
  // flusso parta in una scheda, con l'URL di autorizzazione e i parametri PKCE,
  // e che il browser di sistema resti chiuso.
  const pagina = await googleFinto(app, testServer);

  // Da sloggato il pulsante account apre un menu nativo (BrowserWindow): la
  // voce "Accedi con Google" avvia il login. Il bottone account è un trigger
  // interno nascosto (le icone visibili sono nella home): lo azioniamo come fa
  // il bridge, con un click DOM diretto.
  await shell.evaluate(() => document.getElementById('nav-account').click());
  let clicked = false;
  const popupDeadline = Date.now() + 5_000;
  while (Date.now() < popupDeadline && !clicked) {
    const popup = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (popup) {
      const item = popup.locator('.item', { hasText: 'Accedi con Google' });
      try {
        await item.waitFor({ timeout: 1000 });
        await item.click();
        clicked = true;
        break;
      } catch (_) { /* popup non ancora pronto: ritenta */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(clicked, 'voce "Accedi con Google" non trovata nel menu account').toBe(true);

  const url = await indirizzoDellAccesso(app, pagina);
  expect(url, 'il consenso deve aprirsi in una scheda di Filo').toBeTruthy();
  expect(url).toContain('code_challenge=');
  expect(url).toContain('code_challenge_method=S256');
  expect(url).toContain('response_type=code');
  expect(await app.evaluate(() => globalThis.__aperture.length), 'il browser di sistema non deve aprirsi').toBe(0);
});

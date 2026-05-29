// Cablaggio del login "Accedi con Google" nella shell (NON il round-trip live,
// che richiede il consenso Google in un browser reale e non è automatizzabile).
//
// Cosa verifichiamo end-to-end (preload → IPC → main → google-auth):
//   - il pulsante account esiste nella barra indirizzi della shell;
//   - l'API filoShell.auth è esposta e auth.status() risponde con la forma
//     attesa { ok, signedIn:false, profile:null } su userData pulito (nessuna
//     sessione persistita) — gira nel main process, i token non toccano il
//     renderer;
//   - cliccando il pulsante da sloggato parte il login (apre il browser di
//     sistema): lo intercettiamo stubbando shell.openExternal nel main, così
//     asseriamo che il flusso si avvia davvero senza aprire nulla per davvero.

import { test, expect } from './fixtures/electron.mjs';

test('shell: il pulsante account esiste ed è cliccabile', async ({ shell }) => {
  await expect(shell.locator('#nav-account')).toBeAttached({ timeout: 8_000 });
  await expect(shell.locator('#nav-account')).toBeVisible();
});

test('auth.status() risponde dal main: sloggato su userData pulito', async ({ shell }) => {
  const status = await shell.evaluate(() => window.filoShell.auth.status());
  expect(status).toBeTruthy();
  expect(status.ok).toBe(true);
  expect(status.signedIn).toBe(false);
  expect(status.profile).toBeNull();
});

test('click su "Accedi" da sloggato avvia il login (apre il browser di sistema)', async ({ shell, app }) => {
  // Stub di shell.openExternal nel MAIN process: il login apre il consenso
  // Google nel browser di sistema; qui lo intercettiamo per asserire che il
  // flusso parte (URL di authorization Google con i parametri PKCE) senza
  // aprire nulla davvero né attendere il redirect.
  const opened = await app.evaluate(async ({ shell: electronShell }) => {
    return await new Promise((resolve) => {
      const orig = electronShell.openExternal;
      electronShell.openExternal = async (url) => {
        electronShell.openExternal = orig; // ripristina
        resolve(url);
        return undefined;
      };
      // timeout di sicurezza se non viene mai chiamato
      setTimeout(() => resolve(null), 8_000);
    });
  });

  // Scatena il click sul pulsante (non await: signIn resta in attesa del
  // redirect che non arriverà — a noi basta che il browser sia stato aperto).
  await shell.locator('#nav-account').click();

  const url = await opened;
  expect(url, 'shell.openExternal deve essere chiamato con l\'URL di consenso Google').toBeTruthy();
  expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
  expect(url).toContain('code_challenge=');
  expect(url).toContain('code_challenge_method=S256');
  expect(url).toContain('response_type=code');
});

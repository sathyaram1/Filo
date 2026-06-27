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
//     "Accedi con Google" avvia il login (apre il browser di sistema): lo
//     intercettiamo stubbando shell.openExternal nel main, così asseriamo che il
//     flusso si avvia davvero senza aprire nulla per davvero.

import { test, expect } from './fixtures/electron.mjs';

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

test('"Accedi con Google" dal menu account avvia il login (apre il browser di sistema)', async ({ shell, app }) => {
  // Stub di shell.openExternal nel MAIN process: il login apre il consenso
  // Google nel browser di sistema; qui lo intercettiamo per asserire che il
  // flusso parte (URL di authorization Google con i parametri PKCE) senza
  // aprire nulla davvero né attendere il redirect. L'URL catturato finisce su
  // un global del main, che rileggiamo dopo il click (no deadlock).
  await app.evaluate(({ shell: electronShell }) => {
    globalThis.__filoTestOpenedUrl = null;
    const orig = electronShell.openExternal;
    electronShell.openExternal = async (url) => {
      globalThis.__filoTestOpenedUrl = url;
      electronShell.openExternal = orig; // ripristina
      return undefined;
    };
  });

  // Da sloggato il pulsante account apre un menu nativo (BrowserWindow): la
  // voce "Accedi con Google" avvia il login. Clicchiamo il bottone account, poi
  // la voce nel popup (non await sul login: signIn resta in attesa del redirect
  // che non arriverà — a noi basta che il browser sia stato aperto).
  // Il bottone account è un trigger interno nascosto (le icone visibili sono
  // nella home): lo azioniamo come fa il bridge, con un click DOM diretto.
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

  // Attendi che il main abbia ricevuto la chiamata a openExternal.
  let url = null;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    url = await app.evaluate(() => globalThis.__filoTestOpenedUrl || null);
    if (url) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  expect(url, 'shell.openExternal deve essere chiamato con l\'URL di consenso Google').toBeTruthy();
  expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
  expect(url).toContain('code_challenge=');
  expect(url).toContain('code_challenge_method=S256');
  expect(url).toContain('response_type=code');
});

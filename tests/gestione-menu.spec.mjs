// Area "Gestione" dell'owner (feature #366.1).
//
// L'owner ha un unico punto d'accesso alle pagine di sola-amministrazione: una
// nuova icona "Gestione" (in alto a destra nella home) che apre un menu nativo
// con "Gestione" (triage feedback) e "Modelli predefiniti". Quelle due voci NON
// devono più comparire nei menu App/Impostazioni, e l'icona/menu non deve essere
// raggiungibile da chi non è owner.
//
// Cosa verifichiamo end-to-end (shell reale → popup-menu nativo):
//   - il menu App NON contiene più "Gestione";
//   - da admin il menu Impostazioni NON contiene più "Modelli predefiniti";
//   - da admin l'icona Gestione apre un menu con "Gestione" + "Modelli predefiniti";
//   - da NON admin l'icona Gestione non apre alcun menu (pagine riservate non esposte).
//
// Pre-condizione che senza il fix fallirebbe: prima, "Gestione" era nel menu App
// e "Modelli predefiniti" nel menu Impostazioni (per gli admin), e non esisteva
// alcun menu Gestione → i primi tre test sarebbero rossi.
//
// Lo stato admin nei test è forzato via window.__shellTest.setAdmin(true) (non
// c'è una sessione Google reale automatizzabile), stesso pattern degli hook di
// pagina (es. window.__mgTest.setAdmin).

import { test, expect } from './fixtures/electron.mjs';

// Clicca un bottone-trigger della shell (icone nascoste: le visibili sono nella
// home) e ritorna il testo del popup-menu nativo aperto.
async function openMenuText(app, shell, btnId) {
  await shell.evaluate((id) => document.getElementById(id).click(), btnId);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const popup = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (popup) {
      try {
        await popup.waitForSelector('.menu', { timeout: 1000 });
        const txt = await popup.locator('.menu').innerText();
        if (txt && txt.trim()) return txt;
      } catch (_) { /* popup non pronto: ritenta */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`popup non aperto/leggibile per #${btnId}`);
}

// Vero se, cliccando il trigger, NON si apre alcun popup-menu entro la finestra.
async function noMenuOpens(app, shell, btnId) {
  await shell.evaluate((id) => document.getElementById(id).click(), btnId);
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const popup = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (popup) {
      try {
        await popup.waitForSelector('.menu', { timeout: 300 });
        const txt = await popup.locator('.menu').innerText();
        if (txt && txt.trim()) return false; // un menu è comparso
      } catch (_) { /* non è un menu leggibile */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

test('menu App: NON contiene più "Gestione"', async ({ app, shell }) => {
  const txt = await openMenuText(app, shell, 'nav-apps');
  // Sanity: è davvero il menu App (contiene le altre app).
  expect(txt, 'non sembra il menu App').toContain('Feedback');
  expect(txt).toContain('Bacheca');
  expect(txt, '"Gestione" è ancora nel menu App: non è stata spostata').not.toContain('Gestione');
});

test('menu Impostazioni (da admin): NON contiene più "Modelli predefiniti"', async ({ app, shell }) => {
  await shell.evaluate(() => window.__shellTest.setAdmin(true));
  const txt = await openMenuText(app, shell, 'nav-settings');
  // Sanity: è davvero il menu Impostazioni.
  expect(txt, 'non sembra il menu Impostazioni').toContain('Preferenze');
  expect(txt, '"Modelli predefiniti" è ancora nel menu Impostazioni: non è stato spostato')
    .not.toContain('Modelli predefiniti');
});

test('da admin: l\'icona Gestione apre un menu con "Gestione" + "Modelli predefiniti"', async ({ app, shell }) => {
  await shell.evaluate(() => window.__shellTest.setAdmin(true));
  const txt = await openMenuText(app, shell, 'nav-manage');
  expect(txt, 'manca "Gestione" (triage feedback) nel menu Gestione').toContain('Gestione');
  expect(txt, 'manca "Modelli predefiniti" nel menu Gestione').toContain('Modelli predefiniti');
});

test('da NON admin: l\'icona Gestione non apre alcun menu (pagine riservate non esposte)', async ({ app, shell }) => {
  await shell.evaluate(() => window.__shellTest.setAdmin(false));
  const noMenu = await noMenuOpens(app, shell, 'nav-manage');
  expect(noMenu, 'un utente non-owner è riuscito ad aprire il menu Gestione').toBe(true);
});

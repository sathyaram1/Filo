// Comandi proprietario (#210): /users, /gift e l'avviso "crediti regalati".
//
// Questi comandi sono riservati all'owner (auth.isAdmin nel main + regole
// Firestore). In ambiente di test NON c'è una sessione Google admin, quindi:
//   • verifichiamo che i comandi siano CABLATI (riconosciuti, arancioni) e che
//     il gate proprietario risponda "comando riservato" a chi non è owner —
//     ESATTAMENTE il comportamento richiesto dalla spec per i non-proprietari;
//   • verifichiamo la validazione lato client di /gift (numero non valido,
//     uso senza argomenti) che non dipende da rete né auth;
//   • verifichiamo che il broadcast GIFT_NOTICE (#210.4) faccia comparire il
//     popup di avviso una volta sola, e che si chiuda con il bottone.
//
// La verifica del REGALO vero (saldo del destinatario che cresce) richiede una
// sessione admin + Firestore live e va fatta a mano dall'owner dopo il deploy
// delle regole: vedi le note del feedback.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function submit(page, command) {
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    const form = document.getElementById('inputForm');
    input.value = cmd;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, command);
}

test('"/users" e "/gift" sono riconosciuti come comandi Filo (non sconosciuti)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  await input.fill('/users');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);

  await input.fill('/gift 2000 mario@esempio.com');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
});

test('"/gift" senza argomenti spiega l\'uso (nessuna chiamata)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  await submit(page, '/gift');
  await expect(page.locator('.dash-bubble')).toContainText('/gift NUMERO EMAIL', { timeout: 8_000 });
});

test('"/gift abc ..." rifiuta un numero non valido lato client', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  await submit(page, '/gift abc mario@esempio.com');
  await expect(page.locator('.dash-bubble')).toContainText(/numero di crediti valido/i, { timeout: 8_000 });
});

test('da NON proprietario, "/users" risponde che è un comando riservato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  await submit(page, '/users');
  await expect(page.locator('.dash-bubble')).toContainText(/riservato al proprietario/i, { timeout: 8_000 });
});

test('da NON proprietario, "/gift" valido risponde che è un comando riservato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  await submit(page, '/gift 2000 mario@esempio.com');
  await expect(page.locator('.dash-bubble')).toContainText(/riservato al proprietario/i, { timeout: 8_000 });
});

test('il broadcast GIFT_NOTICE mostra il popup "crediti in regalo" una volta sola', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  const type = await page.evaluate(() => window.SN_MSG.MSG.GIFT_NOTICE);

  // Spinge il broadcast esattamente come fa broadcastToTabs nel main (#210.4).
  const sendNotice = (amount) => app.evaluate(({ BrowserWindow }, { t, amount }) => {
    const msg = { type: t, amount };
    for (const win of BrowserWindow.getAllWindows()) {
      if (win._filoTabs) {
        for (const tab of win._filoTabs.tabs) {
          try { tab.view.webContents.send('filo:broadcast', msg); } catch (_) {}
        }
      }
      try { win.webContents.send('filo:broadcast', msg); } catch (_) {}
    }
  }, { t: type, amount });

  await sendNotice(50);

  // Compare il popup con l'importo regalato.
  const overlay = page.locator('.sn-confirm-overlay');
  await expect(overlay).toHaveCount(1, { timeout: 8_000 });
  await expect(overlay).toContainText('50 crediti');

  // Chiudendolo sparisce.
  await page.locator('.sn-confirm-overlay .sn-confirm-btn-ok').click();
  await expect(page.locator('.sn-confirm-overlay')).toHaveCount(0, { timeout: 8_000 });
});

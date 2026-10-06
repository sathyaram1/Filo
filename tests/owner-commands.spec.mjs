// Comandi proprietario (#210, #895): /users, /gift e l'avviso "crediti regalati".
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
// Il REGALO vero (saldo del destinatario che cresce) e l'elenco per pseudonimo
// stanno in regalo-per-pseudonimo.spec.mjs, con un owner simulato.

import { test, expect } from './fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from './helpers/confirm.mjs';

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

  await input.fill('/gift 2000 abcdef0123456789');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
});

test('"/gift" senza argomenti spiega l\'uso (nessuna chiamata)', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  await submit(page, '/gift');
  await expect(page.locator('.dash-bubble')).toContainText('/gift NUMERO PSEUDONIMO', { timeout: 8_000 });
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
  await expect(page.locator('.dash-bubble').last()).toContainText(/riservato al proprietario/i, { timeout: 8_000 });
});

test('da NON proprietario, "/gift" valido risponde che è un comando riservato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  await submit(page, '/gift 2000 abcdef0123456789');
  await expect(page.locator('.dash-bubble').last()).toContainText(/riservato al proprietario/i, { timeout: 8_000 });
});

test('il regalo dell\'owner mostra il popup "crediti in regalo" una volta sola, anche con più home aperte', async ({ app, openTab, shell }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  const home = () => app.windows().filter((w) => { try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; } });
  const prima = home().length;
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await expect.poll(() => home().length, { timeout: 20_000 }).toBe(prima + 2);
  for (const h of home()) await h.waitForFunction(() => !!window.SN_CONFIRM_UI, null, { timeout: 20_000 });

  // Come fa il main quando legge l'avviso lasciato dall'owner (#210.4): la spinta arriva a tutte le home.
  await app.evaluate((_e, amount) => globalThis.SN_CREDITS_MAIN.annunciaRegalo(amount), 50);

  // L'utente passa da una home all'altra: il popup lo trova in una sola (#664).
  const ids = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
    .filter((t) => String(t.url || '').startsWith('filo://newtab')).map((t) => t.id));
  const visti = [];
  for (const id of ids) {
    await shell.evaluate((x) => window.filoShell.tabs.activate(x), id);
    await new Promise((r) => setTimeout(r, 1500));
    const testi = await Promise.all(home().map((h) => confirmText(h).catch(() => '')));
    visti.push(testi.filter((t) => t.includes('50 crediti')).length);
  }
  expect(visti.length).toBeGreaterThanOrEqual(3);
  expect(visti, 'home col regalo dopo ogni passaggio').toEqual(visti.map(() => 1));

  // Chiudendolo sparisce, e non ricompare altrove.
  const conPopup = (await Promise.all(home().map(async (h) => ((await confirmText(h).catch(() => '')).includes('50 crediti') ? h : null)))).find(Boolean);
  await clickConfirm(conPopup, 'ok');
  await expect(conPopup.locator(CONFIRM_HOST)).toHaveCount(0, { timeout: 8_000 });
});

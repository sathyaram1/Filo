// Gating admin di "Modelli predefiniti" (Gestione → Impostazioni predefinite, #1414).
//
// La config dei modelli/chiavi predefiniti è condivisa con tutti gli utenti e
// modificabile SOLO dagli admin. Su userData pulito NON c'è sessione, quindi:
//   - aprendo la scheda si vede il messaggio "accesso negato", non l'editor;
//   - il main RIFIUTA defaults_get e defaults_update con { ok:false } (è il vero
//     gate: anche aggirando la UI, lettura/scrittura non partono senza un admin);
//   - la shell non riceve isAdmin, quindi la voce "Gestione" del menu App
//     non viene mostrata agli utenti comuni.
//
// Pre-condizione che senza il gate fallirebbe: se defaults_get tornasse la config
// (con eventuali chiavi) a chiunque, questi test diventerebbero rossi.

import { test, expect } from './fixtures/electron.mjs';
import { GESTIONE, apriScheda } from './helpers/gestione.mjs';

test('Modelli predefiniti: da sloggato la scheda mostra accesso negato, non l\'editor', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await apriScheda(page, 'predefiniti');
  await expect(page.locator('#sec-denied')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#editor')).toBeHidden();
});

test('Modelli predefiniti: il main rifiuta defaults_get e defaults_update da non admin', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await page.waitForSelector('#panel-predefiniti', { state: 'attached', timeout: 8_000 });

  const getRes = await page.evaluate(() => window.filo.message({ type: 'defaults_get' }));
  expect(getRes).toBeTruthy();
  expect(getRes.ok).toBe(false);
  expect(String(getRes.error || '')).toMatch(/amministrator/i);

  const updRes = await page.evaluate(() =>
    window.filo.message({ type: 'defaults_update', config: { provider: 'openrouter' } })
  );
  expect(updRes).toBeTruthy();
  expect(updRes.ok).toBe(false);
  expect(String(updRes.error || '')).toMatch(/amministrator/i);
});

test('Shell: utente non admin non riceve isAdmin (voce "Gestione" nascosta)', async ({ shell }) => {
  const status = await shell.evaluate(() => window.filoShell.auth.status());
  expect(status).toBeTruthy();
  expect(status.ok).toBe(true);
  expect(status.signedIn).toBe(false);
  expect(!!status.isAdmin).toBe(false);
});

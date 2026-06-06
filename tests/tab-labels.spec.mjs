// Nomi delle schede puliti per le pagine interne di Filo.
//
// Feedback utente: "cambia i nomi delle tab. ora si chiamano filo-nuova → Home.
// tutte le altre semplicemente il nome del tasto per raggiungerli (modelli al
// posto di opzioni). leva la scritta Filo davanti".
//
// I test ASSERISCONO che la scheda mostri l'etichetta pulita (es. "Modelli")
// e che NESSUNA scheda mostri il prefisso "Filo —".

import { test, expect } from './fixtures/electron.mjs';

test('la newtab si chiama "Home" (non "Filo — Nuova scheda")', async ({ shell }) => {
  const title = shell.locator('.tab.active .title');
  await expect(title).toHaveText('Home', { timeout: 8_000 });
});

test('le pagine interne usano il nome del tasto, senza prefisso "Filo —"', async ({ shell, openTab }) => {
  // Opzioni → "Modelli" (nome del tasto che la apre).
  await openTab('filo://options/options.html');
  await expect(shell.locator('.tab .title', { hasText: 'Modelli' })).toBeVisible({ timeout: 8_000 });

  await openTab('filo://security/security.html');
  await expect(shell.locator('.tab .title', { hasText: 'Sicurezza' })).toBeVisible({ timeout: 8_000 });

  await openTab('filo://preferences/preferences.html');
  await expect(shell.locator('.tab .title', { hasText: 'Preferenze' })).toBeVisible({ timeout: 8_000 });

  // Nessuna scheda mostra il prefisso "Filo —".
  const titles = await shell.locator('.tab .title').allTextContents();
  for (const t of titles) {
    expect(t, `la scheda "${t}" non deve contenere "Filo"`).not.toMatch(/Filo\s*[—–-]/i);
  }
});

// Feedback yChcz: niente più pulsanti "Salva" nei menu impostazioni — le
// modifiche si applicano e si persistono subito. L'esempio dell'utente: appena
// scelgo un nuovo tema, il tema cambia.

import { test, expect } from './fixtures/electron.mjs';

test('Preferenze: nessun pulsante Salva, cambiare tema lo applica e lo persiste subito', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#theme', { timeout: 8_000 });

  // Il pulsante Salva non esiste più.
  await expect(page.locator('#save')).toHaveCount(0);

  // Cambiando il tema a "scuro" il documento passa subito a dark (senza salvare).
  await page.selectOption('#theme', 'dark');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.snTheme), { timeout: 4_000 })
    .toBe('dark');

  // La conferma "Salvato" lampeggia.
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // La scelta è persistita: ricaricando, la select è ancora su "dark".
  await page.reload();
  await page.waitForSelector('#theme', { timeout: 8_000 });
  await expect(page.locator('#theme')).toHaveValue('dark');
});

test('Sicurezza e Modelli: il pulsante Salva è stato rimosso', async ({ openTab }) => {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('#sec-protect-ip', { timeout: 8_000 });
  await expect(sec.locator('#save')).toHaveCount(0);

  const opts = await openTab('filo://options/options.html');
  await opts.waitForSelector('#provider', { timeout: 8_000 });
  await expect(opts.locator('#save')).toHaveCount(0);
});

test('Modelli: cambiare il limite mensile si salva da solo (auto-save)', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#monthlyLimit', { timeout: 8_000 });

  await page.fill('#monthlyLimit', '12');
  // `change` scatta al blur.
  await page.locator('#provider').focus();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  await page.reload();
  await page.waitForSelector('#monthlyLimit', { timeout: 8_000 });
  await expect(page.locator('#monthlyLimit')).toHaveValue('12');
});

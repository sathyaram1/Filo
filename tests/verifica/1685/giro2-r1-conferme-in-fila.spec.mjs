// Verifica #1685 giro 2, rilievo 1: due comandi da confermare a mano nella stessa risposta. Dati i due OK, il secondo
// anche mentre Filo sta già riprendendo dopo il primo, il modello riceve com'è andato anche il secondo.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

async function ok(page) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
}

test('r1 due comandi confermati uno dopo l\'altro: l\'esito del secondo torna al modello', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('v1685-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo le due cartelle.', toolCalls: [
        { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'uno')}"`, spiegazione: 'Creo la cartella uno' }) },
        { id: 'c2', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'due')}"`, spiegazione: 'Creo la cartella due' }) },
      ] },
      { text: 'Aspetto i tuoi OK.' },
      // Il modello vero ci mette qualche secondo: il secondo OK arriva mentre Filo sta ancora riprendendo.
      { text: 'Fatta la prima.', ritardoMs: 3000 },
      { text: 'Fatte tutte e due.' },
    ]);
    await chiedi(page, 'crea le cartelle uno e due');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto i tuoi OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await expect(bottoni).toHaveCount(2);
    await bottoni.filter({ hasText: 'uno' }).click();
    await ok(page);
    await expect(bottoni.filter({ hasText: 'uno' })).toHaveText(/^✓/, { timeout: 10_000 });
    await bottoni.filter({ hasText: 'due' }).click();
    await ok(page);
    await expect(bottoni.filter({ hasText: 'due' })).toHaveText(/^✓/, { timeout: 10_000 });
    await expect.poll(async () => (await chiamateAlModello(app)).slice(2)
      .some((c) => /fatta: Comando eseguito · mkdir[^\n]*due/.test(JSON.stringify(c[c.length - 1]))), {
      timeout: 10_000, message: 'dato l\'OK al secondo comando, il modello sa che è stato fatto e può continuare',
    }).toBe(true);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

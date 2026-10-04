// Verifica #870 giro 7, rilievo 1: «Sposta» sulla carta di una sveglia non cancella quello che l'utente stava scrivendo.
import { test, expect } from '../../fixtures/electron.mjs';

async function home(app) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); await expect(w.locator('#tieni .dash-carta').first()).toBeVisible({ timeout: 10_000 }); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('«Sposta» della sveglia con una bozza nel campo: la bozza non si perde', async ({ app }) => {
  test.setTimeout(45_000);
  const page = await home(app);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addAlarm({ label: 'palestra', time: '07:00', repeat: 'feriali' }); });
  await page.reload();
  await home(app);
  const bozza = 'scrivi una lettera lunga al condominio sul riscaldamento';
  await page.locator('#input').click();
  await page.keyboard.type(bozza);
  await page.locator('#accade .dash-carta[data-tipo="sveglia"] .dash-carta-az.principale').click();
  const dopo = await page.locator('#input').inputValue();
  if (!dopo.includes(bozza)) {
    // Se la frase prende il posto della bozza, almeno Ctrl+Z la deve riportare.
    await page.keyboard.press('Control+z');
    await expect(page.locator('#input')).toHaveValue(new RegExp(bozza));
  }
});

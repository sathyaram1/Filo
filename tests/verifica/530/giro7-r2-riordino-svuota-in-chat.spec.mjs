// Verifica #530, giro 7: quando la regola chiede, il riordino delle schede e lo svuotamento dell'archivio chiesti in
// chat mostrano il loro bottone, e la domanda dice il motivo come ogni altra domanda della regola.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

async function apriDiari(page) {
  for (const b of await page.locator('button', { hasText: /Come ha lavorato|Ha / }).all()) {
    try { if ((await b.getAttribute('aria-expanded')) !== 'true') await b.click({ timeout: 1000 }); } catch (_) {}
  }
}

test('Conservativo, chat nuova: «riordina le schede» dà il bottone e il popup', async ({ app }) => {
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
  const page = await home(app);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }] },
      { text: 'Ecco.' },
    ]);
    await chiedi(page, 'riordina le schede');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Ecco.' })).toBeVisible({ timeout: 15000 });
    await apriDiari(page);
    const btn = page.locator('button', { hasText: 'Riordina e archivia le schede' });
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 8000 });
    await clickConfirm(page, 'cancel');
  } finally {
    await ripristina(app);
  }
});

test('Normale dopo una ricerca: il riordino chiede, e il popup dice perché', async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [
      { title: 'Meteo', url: 'https://meteo.test/', content: 'sole' },
    ] });
  });
  const page = await home(app);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'meteo' }) }] },
      { text: 'Sole.' },
      { toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }] },
      { text: 'Ecco.' },
    ]);
    await chiedi(page, 'cerca il meteo');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Sole.' })).toBeVisible({ timeout: 15000 });
    await chiedi(page, 'riordina le schede');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Ecco.' })).toBeVisible({ timeout: 15000 });
    await apriDiari(page);
    const btn = page.locator('button', { hasText: 'Riordina e archivia le schede' });
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 8000 });
    const testo = await confirmText(page);
    await clickConfirm(page, 'cancel');
    expect(testo).toContain('ricerca sul web');
  } finally {
    await ripristina(app);
  }
});

test('Normale: «elimina dall\'archivio le schede sulle ricette» mostra l\'elenco e il bottone per eliminarle', async ({ app }) => {
  const page = await home(app);
  try {
    await modelloFinto(app, [
      { toolCalls: [{ id: 'a1', name: 'CANCELLA_ARCHIVIO', arguments: JSON.stringify({ query: 'ricette' }) }] },
      { text: 'Ecco.' },
    ]);
    await chiedi(page, 'elimina dall\'archivio le schede sulle ricette');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Ecco.' })).toBeVisible({ timeout: 15000 });
    await apriDiari(page);
    await expect(page.locator('.dash-delete-panel')).toBeVisible({ timeout: 5000 });
  } finally {
    await ripristina(app);
  }
});

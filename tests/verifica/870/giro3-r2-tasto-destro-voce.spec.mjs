// #870 giro 3, rilievo 2: il tasto destro su un documento dentro la carta dell'Editor parla di quel documento,
// non della carta intera.
import { test, expect } from '../../fixtures/electron.mjs';

test('tasto destro su un documento recente: il menu è di quel documento', async ({ app }) => {
  test.setTimeout(45_000);
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => w.url().startsWith('filo://newtab')); return !!page; }, { timeout: 15_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(async () => {
    const q = new Date().toISOString();
    const file = (id, title) => ({ id, meta: { title, created: q, modified: q, version: 1 }, modules: [], content: {} });
    await chrome.storage.local.set({ 'filo.editor.collection': { version: 1, activeId: 'a', files: [file('a', 'Lettera al condominio'), file('b', 'Ricette')] } });
  });
  await page.reload();
  const voce = page.locator('#tieni .dash-carta[data-tipo="editor"] .dash-carta-voce', { hasText: 'Ricette' });
  await expect(voce).toBeVisible({ timeout: 10_000 });
  await voce.click({ button: 'right' });
  const menu = page.locator('.dash-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Ricette');
});

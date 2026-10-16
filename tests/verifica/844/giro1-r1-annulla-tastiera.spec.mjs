// #844 giro 1, rilievo 1: chi toglie una pagina da tastiera in una lista normale deve poterla rimettere con pochi tasti,
// non attraversando tutte le schede rimaste prima che l'avviso con «Annulla» sparisca.
import { test, expect } from '../../fixtures/electron.mjs';

const HOME = 'filo://home/home.html';
const ORA = Date.parse('2026-10-10T10:00:00Z');
const voce = (i) => ({
  id: `p${i}`, url: `https://esempio${i}.example/x`, title: `Pagina ${i}`, favicon: '', thumbnail: '',
  savedAt: new Date(ORA - i * 3600e3).toISOString(), categoryId: null, category: null,
});
const ids = (home) => home.evaluate(async () => ((await chrome.storage.local.get('savedPages')).savedPages || []).map((p) => p.id));

test('r1 rimossa da tastiera in una lista di dodici pagine, si rimette con al massimo quattro tasti', async ({ openTab }) => {
  const home = await openTab(HOME);
  await home.evaluate(async (p) => {
    await chrome.storage.local.set({ savedPages: p, categories: [] });
    await window.SN_STORAGE.updateSettings({ featureFlags: { categorize: false } });
  }, Array.from({ length: 12 }, (_, i) => voce(i + 1)));
  await home.reload();
  await home.waitForLoadState('domcontentloaded');
  await expect(home.locator('#grid .sn-card')).toHaveCount(12);

  await home.locator('#grid .sn-card[data-page-id="p1"]').focus();
  await home.keyboard.press('Shift+F10');
  await expect(home.locator('.home-ctxmenu')).toBeVisible();
  await home.keyboard.press('End');
  await home.keyboard.press('Enter');
  await expect(home.locator('#grid .sn-card[data-page-id="p1"]')).toHaveCount(0);

  // Qualunque strada corta va bene: Ctrl+Z, il fuoco sull'avviso, o «Annulla» a pochi Tab.
  const tasti = ['Control+z', 'Tab', 'Tab', 'Tab'];
  let tornata = false;
  for (const t of tasti) {
    if (await home.evaluate(() => document.activeElement?.classList.contains('home-annulla-btn'))) {
      await home.keyboard.press('Enter');
    } else {
      await home.keyboard.press(t);
    }
    await home.waitForTimeout(150);
    if ((await ids(home)).includes('p1')) { tornata = true; break; }
  }
  expect(tornata).toBe(true);
  await expect.poll(() => ids(home)).toEqual(Array.from({ length: 12 }, (_, i) => `p${i + 1}`));
});

// Verifica #821, giro 1, rilievo 2: portare la saturazione a 0 e poi indietro non deve lasciare grigio per sempre un sito.
import { test, expect } from '../../fixtures/electron.mjs';

const favicon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="rgb(255,0,0)"/></svg>');
const PAGINA = `<!doctype html><html><head><link rel="icon" href="${favicon}"><title>Tubo rosso</title></head><body>rosso</body></html>`;
const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c || '') || [, ''])[1].split(',').slice(0, 3).map(Number);

test('saturazione_tab a 0 e poi di nuovo a 1: la scheda chiusa in quel momento torna rossa in Cronologia', async ({ shell, openTab, testServer }) => {
  const set = (s) => shell.evaluate((x) => window.filoShell.message({ type: 'update_settings', settings: x }), s);
  const identita = () => shell.evaluate(async () =>
    (await window.filoShell.tabs.snapshot()).tabs.find((t) => t.title === 'Tubo rosso')?.identityColor || null);
  await testServer.openReady(openTab, PAGINA);
  await expect.poll(identita, { timeout: 8_000 }).toBe('rgb(255, 0, 0)');

  await set({ tabColor: { saturazione_tab: 0 } });
  await expect.poll(identita, { timeout: 8_000 }).toBe('rgb(128, 128, 128)');
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.close(s.tabs.find((t) => t.title === 'Tubo rosso').id);
  });
  await set({ tabColor: { saturazione_tab: 1 } });

  const arc = await openTab('filo://archive/archive.html');
  const chip = arc.locator('.arc-tab', { hasText: 'Tubo rosso' });
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => {
    const [r, g, b] = nums(await chip.evaluate((el) => getComputedStyle(el).backgroundColor));
    return r - Math.max(g, b);
  }, { timeout: 5_000 }).toBeGreaterThan(100);
});

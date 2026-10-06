// Verifica #821, giro 2: saturazione a 0 e ritorno, luminosità agli estremi, Cronologia.
import { test, expect } from '../../fixtures/electron.mjs';

const svg = (inner) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${inner}</svg>`);
const page = (title, icon) => '<!doctype html><html><head>' +
  (icon ? `<link rel="icon" href="${icon}">` : '') +
  `<title>${title}</title></head><body style="margin:0;height:1200px">${title}</body></html>`;
const ROSSO = svg('<rect width="32" height="32" fill="rgb(255,0,0)"/>');

const lum = ([r, g, b]) => {
  const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c || '') || [, ''])[1].split(',').slice(0, 3).map(Number);

test('saturazione a 0, scheda chiusa, saturazione di nuovo a 1: barra e Cronologia rosse; luminosità agli estremi leggibile', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const set = (st) => shell.evaluate((s) => window.filoShell.message({ type: 'update_settings', settings: s }), st);
  const leggi = (titolo) => shell.evaluate((tt) => {
    const el = [...document.querySelectorAll('.tab')].find((x) => x.querySelector('.title')?.textContent === tt);
    if (!el) return null;
    return { bg: getComputedStyle(el).backgroundColor, title: getComputedStyle(el.querySelector('.title')).color,
      close: getComputedStyle(el.querySelector('.close')).color };
  }, titolo);

  await set({ theme: 'light', tabColor: { saturazione_tab: 0 } });
  await testServer.openReady(openTab, page('Rosso uno', ROSSO));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await expect.poll(() => shell.evaluate(async (i) => (await window.filoShell.tabs.snapshot()).tabs.find((t) => t.id === i)?.identityColor || null, id),
    { timeout: 10_000 }).toBeTruthy();
  await testServer.openReady(openTab, page('Altro', null));
  await expect.poll(async () => { const r = await leggi('Rosso uno'); const b = r && nums(r.bg); return b && Math.max(...b) - Math.min(...b); }).toBeLessThan(6);

  await set({ tabColor: { saturazione_tab: 1 } });
  await expect.poll(async () => { const r = await leggi('Rosso uno'); const b = r && nums(r.bg); return b && b[0] - b[1]; }).toBeGreaterThan(120);

  for (const l of [0, 1, 0.15, 0.85]) {
    await set({ tabColor: { luminosita_tab: l, opacita_tab: 1 } });
    await shell.waitForTimeout(300);
    const r = await leggi('Rosso uno');
    expect(contrast(nums(r.title), nums(r.bg)), `luminosità ${l}: ${r.title} su ${r.bg}`).toBeGreaterThanOrEqual(4.5);
    expect(r.close).toBe(r.title);
  }
  await set({ tabColor: { luminosita_tab: 0.5, opacita_tab: 0.6, saturazione_tab: 0 } });

  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  await set({ tabColor: { saturazione_tab: 1 } });
  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');
  const row = archive.locator('.arc-tab', { hasText: 'Rosso uno' });
  await expect(row).toBeVisible({ timeout: 8_000 });
  const bg = nums(await row.evaluate((el) => getComputedStyle(el).backgroundColor));
  expect(bg[0] - bg[1], `chip ${bg}`).toBeGreaterThan(80);
});

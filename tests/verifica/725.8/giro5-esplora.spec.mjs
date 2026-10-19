// Esplorazione giro 5: avviso nel menu del link su una pagina web e su una pagina interna di Filo.
import { test, expect } from '../../fixtures/electron.mjs';

const FALSI = ['https://poste.it.accesso-sicuro.net/', 'https://paypal.support/', 'https://www.google.com/url?q=https://poste.it.accesso-sicuro.net/'];
const VERI = ['https://www.poste.it/', 'https://www.laposte.fr/', 'https://spid.register.it/'];

async function giudica(page) {
  const out = {};
  const n = await page.locator('a.prova').count();
  for (let i = 0; i < n; i++) {
    const a = page.locator('a.prova').nth(i);
    const href = await a.getAttribute('href');
    await a.click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    await page.waitForTimeout(400);
    const w = page.locator('.sn-menu .sn-menu-link-warn');
    out[href] = (await w.count()) ? ((await w.textContent()) || '').trim() : '';
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  return out;
}

const link = (u) => `<p><a class="prova" href="${u}">${u}</a></p>`;

test('pagina web', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">${[...FALSI, ...VERI].map(link).join('')}</body></html>`);
  const r = await giudica(page);
  await page.screenshot({ path: 'tests/.shots/725.8-giro5-web.png' });
  console.log(JSON.stringify(r, null, 1));
  for (const u of FALSI) expect(r[u], u).toContain('potrebbe essere un’imitazione');
  for (const u of VERI) expect(r[u], u).toBe('');
});

test('pagina interna', async ({ openTab }) => {
  const page = await openTab('filo://credits/credits.html');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((html) => { const d = document.createElement('div'); d.innerHTML = html; d.style.cssText = 'position:fixed;top:10px;left:10px;z-index:99999;background:#fff;padding:8px'; document.body.appendChild(d); }, [...FALSI, ...VERI].map(link).join(''));
  const r = await giudica(page);
  console.log(JSON.stringify(r, null, 1));
  for (const u of FALSI) expect(r[u], u).toContain('potrebbe essere un’imitazione');
  for (const u of VERI) expect(r[u], u).toBe('');
});

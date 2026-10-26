// Verifica #1467 giro 3, r1: la persona clicca l'elemento che l'Aiuto le ha indicato e la pagina cambia: la sessione
// finisce lì, ma non l'ha lasciata lei. Non si conta «chiusa prima», come chi chiude il pannello senza finire.
import { test, expect } from '../../fixtures/electron.mjs';

const aiuto = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora.aiuto || {})) out[c] = (out[c] || 0) + n;
  return out;
});

test('r1 l’Aiuto che indica un passo e la pagina che cambia al clic della persona non si conta chiusa prima', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/?prova=g3r1');
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = 'vai-account';
    b.textContent = 'Account';
    b.style.cssText = 'position:fixed;left:40px;top:120px;z-index:5;padding:12px 20px';
    b.addEventListener('click', () => { location.href = 'filo://newtab/?prova=g3r1-account'; });
    document.body.appendChild(b);
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request') {
        return Promise.resolve({ ok: true, text: '{"text":"Apri «Account».","status":"continue","highlight":{"selector":"#vai-account","action":"click","note":"Clicca qui"}}' });
      }
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      return orig(msg, ...rest);
    };
  });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.fill('.sn-sidebar-input textarea', 'come disdico l\'abbonamento?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar-conv')).toContainText('Apri «Account».', { timeout: 20_000 });
  await expect(page.locator('.sn-highlight')).toHaveCount(1, { timeout: 5_000 });

  // La persona fa quello che l'Aiuto le ha detto: il sito va alla pagina dell'account.
  await page.locator('#vai-account').click();
  await page.waitForURL(/g3r1-account/, { timeout: 10_000 });

  await expect.poll(async () => Object.keys(await aiuto(app)).length, { timeout: 8_000 }).toBe(1);
  const [chiave] = Object.keys(await aiuto(app));
  expect(chiave).toMatch(/\|p1\|/);
  expect(chiave).not.toMatch(/^chiusa_prima\|/);
});

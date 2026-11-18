// Verifica #2383, giro 1, rilievo 1: nella barra laterale (Aiuto) la frase presa da una ricerca web ha l'etichetta.
import { test, expect } from '../../fixtures/electron.mjs';

async function preparaAgente(page) {
  await page.evaluate(() => {
    let turnoAi = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'ai_request') {
        if (msg.payload && msg.payload.userMessage && !turnoAi) {
          turnoAi = 1;
          return Promise.resolve({ ok: true, text: '{"action":"web_search","query":"come si disdice"}' });
        }
        return Promise.resolve({ ok: true, text: JSON.stringify({ text: 'Si disdice dalla pagina Account. [[fonte: https://esempio.it/guida | Vai in Account.]]', status: 'done' }) });
      }
      if (msg && msg.type === 'web_search') {
        return Promise.resolve({ ok: true, provider: 'tavily', results: [{ title: 'Guida', url: 'https://esempio.it/guida', snippet: 'Vai in Account.' }] });
      }
      if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
      return orig(msg, ...rest);
    };
  });
}

test('r1 la risposta dell\'Aiuto presa da un risultato di ricerca porta il nome del sito, non il marcatore', async ({ openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await preparaAgente(page);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  await page.fill('.sn-sidebar-input textarea', 'come disdico l\'abbonamento?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  const risposta = page.locator('.sn-sidebar-msg-assistant', { hasText: 'Si disdice dalla pagina Account' });
  await expect(risposta).toBeVisible({ timeout: 20_000 });
  await expect(risposta).not.toContainText('[[fonte');
  await expect(risposta.locator('.filo-fonte')).toHaveText('esempio.it');
});

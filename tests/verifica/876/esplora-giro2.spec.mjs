import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.cwd(), 'tests', '.shots');

test('esplora giro 2', async ({ openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 10_000 });
  await sec.locator('input[name="cookie-mode"][value="privacy"]').check();
  await sec.locator('#cookie-wl-input').fill('https://mail.google.com/mail/u/0/');
  await sec.locator('#cookie-wl-input').press('Enter');
  await sec.locator('#cookie-wl-input').fill('github.io');
  await sec.locator('#cookie-wl-input').press('Enter');
  console.log('LISTA', await sec.locator('#cookie-wl-list li span').allTextContents());
  console.log('ERR', await sec.locator('#cookie-wl-error').textContent());
  console.log('PLACEHOLDER', await sec.locator('#cookie-wl-input').getAttribute('placeholder'));
  await sec.locator('#cookie-wl-list').scrollIntoViewIfNeeded();
  await sec.screenshot({ path: join(SHOTS, 'v876g2-chiaro.png') });
  await sec.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
  await sec.waitForTimeout(800);
  await sec.screenshot({ path: join(SHOTS, 'v876g2-scuro.png') });
  // voce lunghissima
  await sec.locator('#cookie-wl-input').fill('a'.repeat(60) + '.' + 'b'.repeat(60) + '.github.io');
  await sec.locator('#cookie-wl-input').press('Enter');
  console.log('LISTA2', await sec.locator('#cookie-wl-list li span').allTextContents());
  // salvataggio a casella non vuota con piattaforma, poi ricarica
  await sec.locator('#cookie-wl-input').fill('vercel.app');
  await sec.locator('#cookie-wl-input').press('Tab');
  await sec.waitForTimeout(1500);
  const s = await sec.evaluate(() => chrome.runtime.sendMessage({ type: 'get_settings' }));
  console.log('SALVATI', JSON.stringify(s && (s.settings || s).security && (s.settings || s).security.cookies));
  // voci vecchie
  await sec.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { security: { cookies: { trustedSites: ['mail.google.com', 'accounts.google.com', 'github.io', 'news.bbc.co.uk'] } } } }));
  await sec.reload();
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 10_000 });
  await sec.waitForTimeout(800);
  console.log('LISTA-VECCHIE', await sec.locator('#cookie-wl-list li span').allTextContents());
  console.log('ERR-VECCHIE', await sec.locator('#cookie-wl-error').textContent());
});

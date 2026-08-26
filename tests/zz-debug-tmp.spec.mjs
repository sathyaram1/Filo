import { test, expect } from './fixtures/electron.mjs';

test('debug console', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><p id="paragraph">Ciao mondo</p></body></html>`);
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}\n${e.stack}`));
  await page.locator('#paragraph').click({ button: 'right' });
  await page.waitForTimeout(2000);
  console.log('---LOGS---\n' + logs.join('\n'));
  console.log('menu count', await page.locator('.sn-menu').count());
});

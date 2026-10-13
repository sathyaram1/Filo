import { test, expect } from './fixtures/electron.mjs';
const CON_MENU = `<!doctype html><html><head><meta property="og:site_name" content="Lavagna"></head>
<body style="margin:0;padding:40px"><div id="area" style="width:420px;height:220px;background:#f6efe2">area</div>
<script>document.getElementById('area').addEventListener('contextmenu', function (e) { e.preventDefault(); console.log('PAGE handler', e.isTrusted); });</script></body></html>`;
test('debug', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, CON_MENU);
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await page.waitForTimeout(800);
  console.log(await page.locator('.sn-menu').first().innerText().catch(() => 'nomenu'));
});

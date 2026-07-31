// PROBE TEMPORANEO — tasto destro su link/immagine dentro uno Shadow DOM
import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="font:16px/1.6 sans-serif;padding:24px">
  <h1>Shadow DOM</h1>
  <p><a id="plainLink" href="https://example.com/normale">link normale (light DOM)</a></p>
  <img id="plainImg" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Crect width='120' height='60' fill='%23c45a3b'/%3E%3C/svg%3E" width="120" height="60">
  <div id="host"></div>
  <script>
    const host = document.getElementById('host');
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = \`
      <div style="padding:16px;border:2px dashed #666;margin-top:16px">
        <p><a id="sLink" href="https://example.com/dentro-shadow">link dentro shadow DOM</a></p>
        <img id="sImg" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Crect width='120' height='60' fill='%23336699'/%3E%3C/svg%3E" width="120" height="60">
      </div>\`;
  </script>
</body></html>`;

async function menuText(page) {
  await page.waitForTimeout(700);
  const c = await page.locator('.sn-menu').count();
  if (!c) return '(NESSUN MENU)';
  const t = await page.locator('.sn-menu').first().textContent();
  return (t || '').replace(/\s+/g, ' ').trim();
}

test('menu su link/immagine: light DOM vs shadow DOM', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);
  await page.waitForTimeout(1200);

  await page.locator('#plainLink').click({ button: 'right' });
  console.log('LIGHT LINK  >>>', await menuText(page));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  await page.locator('#plainImg').click({ button: 'right' });
  console.log('LIGHT IMG   >>>', await menuText(page));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  const sLink = page.locator('#host').locator('#sLink');
  await sLink.click({ button: 'right' });
  console.log('SHADOW LINK >>>', await menuText(page));
  await page.screenshot({ path: 'tests/.shots/audit-shadow-link.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  const sImg = page.locator('#host').locator('#sImg');
  await sImg.click({ button: 'right' });
  console.log('SHADOW IMG  >>>', await menuText(page));
  await page.screenshot({ path: 'tests/.shots/audit-shadow-img.png' });
});

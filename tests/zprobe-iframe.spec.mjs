// PROBE TEMPORANEO — tasto destro dentro un iframe e su elementi "immagine-like"
import { test, expect } from './fixtures/electron.mjs';

test('tasto destro dentro un iframe same-origin', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const inner = testServer.html(`<!doctype html><html><body style="margin:0;background:#eef">
    <p id="p" style="padding:30px;font:16px sans-serif">Testo dentro l'iframe, selezionabile.</p>
  </body></html>`);
  const html = `<!doctype html><html><body style="font:16px sans-serif">
    <h1>Host</h1>
    <iframe id="f" src="${inner}" style="width:600px;height:200px;border:1px solid #333"></iframe>
    <p id="outside">fuori</p>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  await page.waitForTimeout(1500);

  // sanity: fuori dall'iframe il menu compare
  await page.locator('#outside').click({ button: 'right' });
  const outMenu = await page.locator('.sn-menu').count();
  console.log('MENU FUORI IFRAME >>>', outMenu);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const fr = page.frameLocator('#f');
  await fr.locator('#p').click({ button: 'right' });
  await page.waitForTimeout(800);
  const inTop = await page.locator('.sn-menu').count();
  const inFrame = await fr.locator('.sn-menu').count();
  const frameReady = await page.evaluate(() => {
    const f = document.querySelector('#f');
    try { return f.contentDocument.documentElement.dataset.filoReady || 'NO'; } catch (e) { return 'X-ORIGIN'; }
  });
  console.log('MENU DOPO CLICK IN IFRAME >>> top:', inTop, 'frame:', inFrame, 'frameReady:', frameReady);
  await page.screenshot({ path: 'tests/.shots/audit-iframe-menu.png' });
});

test('tasto destro su canvas / svg / div con background-image', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const html = `<!doctype html><html><body style="font:16px sans-serif">
    <canvas id="c" width="200" height="120" style="border:1px solid #000"></canvas>
    <svg id="s" width="200" height="120"><rect width="200" height="120" fill="#c45a3b"/></svg>
    <div id="bg" style="width:200px;height:120px;background:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22green%22/%3E%3C/svg%3E')"></div>
    <script>const x=document.getElementById('c').getContext('2d');x.fillStyle='#39f';x.fillRect(0,0,200,120);</script>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  await page.waitForTimeout(1200);
  for (const id of ['c', 's', 'bg']) {
    await page.locator('#' + id).click({ button: 'right' });
    await page.waitForTimeout(600);
    const items = await page.locator('.sn-menu .sn-menu-item, .sn-menu [class*=item]').allTextContents().catch(() => []);
    const raw = await page.locator('.sn-menu').first().textContent().catch(() => '(nessun menu)');
    console.log(`MENU su #${id} >>>`, JSON.stringify((raw || '').replace(/\s+/g, ' ').slice(0, 400)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
});

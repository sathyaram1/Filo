// debug temporaneo #406 — slot
import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:30px;font:16px sans-serif">
  <div id="host-slot"><a id="slot-link" href="https://example.com/slotted">link slottato</a></div>
  <script>
    const r = document.querySelector('#host-slot').attachShadow({ mode: 'open' });
    r.innerHTML = '<div style="border:1px solid #ccc;padding:8px"><slot></slot></div>';
  </script>
</body></html>`;

test('slot debug', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  const box = await page.locator('#slot-link').boundingBox();
  console.log('box', JSON.stringify(box));
  const info = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return { tag: el && el.tagName, id: el && el.id };
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  console.log('elementFromPoint', JSON.stringify(info));

  const path = await page.evaluate(([x, y]) => new Promise((res) => {
    const h = (e) => {
      window.removeEventListener('contextmenu', h, true);
      res(e.composedPath().slice(0, 5).map((n) => (n.tagName || String(n)) + '#' + (n.id || '')));
    };
    window.addEventListener('contextmenu', h, true);
    setTimeout(() => res(['timeout']), 3000);
  }), [box.x + box.width / 2, box.y + box.height / 2]);

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  console.log('composedPath', JSON.stringify(await path));
  await expect(page.locator('.sn-menu')).toBeVisible();
  const labels = await page.$$eval('.sn-menu .sn-menu-item', (els) => els.map((e) => e.textContent.trim()));
  console.log('labels', JSON.stringify(labels));
});

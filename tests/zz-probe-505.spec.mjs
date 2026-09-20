import { test, expect } from './fixtures/electron.mjs';

const P = `<!doctype html><html lang="en"><body>
  <details id="det"><summary id="s">Sum</summary><p id="b">Body text here</p></details>
</body></html>`;

test('probe details', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, P);
  const info = await page.evaluate(() => {
    const b = document.getElementById('b');
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    const det = document.getElementById('det');
    const parent = b.parentElement;
    return {
      display: cs.display,
      visibility: cs.visibility,
      contentVisibility: cs.contentVisibility,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      rect: [r.width, r.height],
      scrollH: b.scrollHeight,
      offsetParent: !!b.offsetParent,
      parentTag: parent.tagName,
      detCs: getComputedStyle(det).contentVisibility,
      checkVis: b.checkVisibility ? b.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true }) : 'n/a',
      ua: navigator.userAgent,
    };
  });
  console.log('PROBE', JSON.stringify(info, null, 2));
  expect(1).toBe(1);
});

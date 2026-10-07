// #589.11 giro 4, rilievo 2: un riquadro incorporato, senza nessun menu aperto, fa togliere alla pagina che lo
// contiene opacità e trasformazioni dei suoi contenitori: un riquadro nascosto si rende visibile da solo.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 un riquadro nascosto dalla pagina resta nascosto anche se chiede di togliere gli effetti', async ({ openTab, testServer }) => {
  const riquadro = testServer.html(`<!doctype html><html><body>annuncio
    <script>setInterval(() => parent.postMessage({ __snVistoSospendi: 1 }, '*'), 500);</script></body></html>`, { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:20px">
    <div id="nascosto" style="opacity:0;transform:scale(0.2)"><iframe src="${riquadro}" style="width:300px;height:200px"></iframe></div>
    </body></html>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  await expect.poll(() => page.frames().some((f) => f.url().includes('sito-pubblico.test'))).toBe(true);
  await page.waitForTimeout(2500);
  const stile = await page.locator('#nascosto').evaluate((e) => [getComputedStyle(e).opacity, getComputedStyle(e).transform]);
  expect(stile[0], 'il contenitore nascosto è diventato visibile').toBe('0');
  expect(stile[1]).not.toBe('none');
});

// PROBE TEMPORANEO — favicon ostile → CSS injection nello style della tab?
import { test, expect } from './fixtures/electron.mjs';

test('favicon con virgolette: cosa arriva alla shell', async ({ shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  // href con " e ) per tentare di uscire da url("...")
  const evil = `data:image/svg+xml,%3Csvg/%3E");position:fixed;left:0;top:0;width:99vw;height:99vh;z-index:99999;background-color:red;x:url("`;
  const html = `<!doctype html><html><head>
    <title>probe</title>
    <link rel="icon" href='${evil}'>
  </head><body><h1>hi</h1></body></html>`;
  const page = await testServer.openReady(openTab, html);
  await page.waitForTimeout(3000);
  const info = await shell.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.tab')) {
      const ico = el.querySelector('.favicon, .ico, [class*=fav], [class*=ico]');
      out.push({
        tabHTML: el.outerHTML.slice(0, 900),
        icoStyle: ico ? ico.getAttribute('style') : null,
        icoRect: ico ? ico.getBoundingClientRect().toJSON() : null,
      });
    }
    return out;
  });
  console.log('SHELLTABS ' + JSON.stringify(info, null, 1));
});

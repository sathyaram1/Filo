// TEMPORANEO — diagnostica dell'apertura menu sulla pagina "testo estremo".
import { test, expect } from './fixtures/electron.mjs';

const LONG = 'The quick brown fox jumps over the lazy dog. '.repeat(240);
const EXTREME = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:16px"><div id="content">
  <div id="long">${LONG}</div>
  <div id="emoji">Weather today 🌤️👨‍👩‍👧‍👦 looks fine, said the crew 🇮🇹</div>
  <div id="quotes">He said &quot;hello&quot; &amp; left &lt;immediately&gt; — didn&#39;t he?</div>
  <div id="rtl" dir="rtl">مرحبا بالعالم this line mixes scripts</div>
  <div id="ctrl">Zero&#8203;width and a tab\there, plus a soft&#173;hyphen</div>
  <div id="jsurl"><a id="jslink" href="javascript:window.__ran=1">Click here for more</a></div>
  <div id="ws">   </div>
  <div id="num">12345 67.89 %</div>
</div></body></html>`;

for (let i = 0; i < 6; i++) {
  test(`debug menu #${i}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, EXTREME);
    await page.locator('#emoji').first().click({ button: 'right', position: { x: 3, y: 3 } });
    await page.waitForTimeout(1200);
    const dump = await page.evaluate(() => {
      const roots = Array.from(document.querySelectorAll('[data-sn-ui], .sn-menu, .sn-popup, [class*="sn-"]'))
        .filter((e) => !e.closest('#content'));
      return {
        n: roots.length,
        classes: roots.slice(0, 12).map((e) => e.className + '|' + e.id),
        icons: Array.from(document.querySelectorAll('[data-sn-icon-id]')).map((e) => e.dataset.snIconId),
        sel: String(window.getSelection() || ''),
      };
    });
    console.log(`RUN ${i}`, JSON.stringify(dump).slice(0, 900));
    expect(dump.icons).toContain('translate');
  });
}

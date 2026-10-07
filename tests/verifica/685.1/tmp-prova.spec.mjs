import { test } from '../../fixtures/electron.mjs';
test('prova', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><h1 id=h>t</h1><x-campo id="c"></x-campo><script>'
  + 'customElements.define("x-campo", class extends HTMLElement { constructor() { super();'
  + ' const r = this.attachShadow({ mode: "closed" }); r.innerHTML = "<input id=i><button id=b>ok</button><div id=e contenteditable>x</div>"; window.__r = r; } });</script>');
  const q = () => page.evaluate(() => { const s = document.getSelection(); const c = document.getElementById('c');
    return JSON.stringify({ ins: document.queryCommandEnabled('insertText'), t: s.type, a: s.anchorNode && (s.anchorNode.nodeName + ':' + s.anchorOffset), fv: c.matches(':focus-visible'), f: c.matches(':focus'), wr: c.matches(':read-write'),
      ccc: getComputedStyle(c).cursor, sec: (s.getComposedRanges ? s.getComposedRanges().length : 'n') }); });
  const box = async (id) => { const b = await page.evaluate((id) => { const r = window.__r.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; }, id); await page.mouse.click(b.x, b.y); };
  await box('i'); await page.keyboard.type('ciao'); console.log('input', await q());
  await box('b'); console.log('bottone dopo input', await q());
  await box('e'); await page.keyboard.type('z'); console.log('ce', await q());
  await box('b'); console.log('bottone dopo ce', await q());
  await page.click('#h'); await box('b'); console.log('bottone da solo', await q());
});

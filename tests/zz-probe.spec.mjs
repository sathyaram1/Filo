// SONDA TEMPORANEA — da cancellare.
import { test } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A plain heading outside any component</h1>

  <closed-card id="cVisible" style="display:block;width:300px;height:50px"></closed-card>
  <closed-card id="cOff" style="display:block;position:absolute;left:-9999px;top:0;width:300px;height:50px"></closed-card>
  <closed-card id="cTransp" style="display:block;opacity:0;width:300px;height:50px"></closed-card>
  <closed-card id="cVis" style="display:block;visibility:hidden;width:300px;height:50px"></closed-card>
  <closed-card id="cCv" style="display:block;content-visibility:hidden;width:300px;height:50px"></closed-card>
  <closed-card id="cNone" style="display:none;width:300px;height:50px"></closed-card>
  <div style="opacity:0"><closed-card id="cParentTransp" style="display:block;width:300px;height:50px"></closed-card></div>

  <details id="det">
    <summary>Open me</summary>
    <div id="detText">Ordinary text inside the collapsed section</div>
    <closed-card id="cInDetails" style="display:block;width:300px;height:50px"></closed-card>
    <open-card id="oInDetails"></open-card>
  </details>

  <div style="margin-top:2000px">
    <closed-card id="cBelow" style="display:block;width:300px;height:50px"></closed-card>
    <div id="belowText">Ordinary text below the fold</div>
  </div>

  <script>
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<h2>Locked headline</h2><p>Body nobody can read.</p>';
      }
    });
    customElements.define('open-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<h2 id="openTitle">Open component headline</h2>';
      }
    });
  </script>
</body></html>`;

test('sonda estrazione', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const out = await page.evaluate(() => {
    const blocks = globalThis.SN_EXTRACT.extractTranslatableBlocks();
    const ids = [];
    for (const b of blocks) {
      const el = b.el;
      ids.push((el.id || el.tagName.toLowerCase()) + ' :: ' + b.text.slice(0, 30));
    }
    const rects = {};
    for (const id of ['cInDetails', 'detText', 'cCv', 'cOff', 'cBelow']) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      rects[id] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })];
    }
    return { unreachable: blocks.unreachable, count: blocks.length, ids, rects };
  });
  console.log('PROBE2 ' + JSON.stringify(out, null, 1));
});

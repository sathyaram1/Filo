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
  </details>

  <div id="panel" hidden>
    <div id="panelText">Ordinary text inside the hidden panel</div>
    <closed-card id="cInPanel" style="display:block;width:300px;height:50px"></closed-card>
  </div>

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
  </script>
</body></html>`;

test('sonda estrazione', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const out = await page.evaluate(() => {
    const ids = ['cVisible', 'cOff', 'cTransp', 'cVis', 'cCv', 'cNone', 'cParentTransp', 'cInDetails', 'detText', 'panelText', 'cInPanel', 'cBelow', 'belowText'];
    const res = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      res[id] = {
        css: [cs.display, cs.visibility, cs.opacity, cs.contentVisibility].join('/'),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        vis: el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }),
      };
    }
    res.__doc = { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, innerW: innerWidth, innerH: innerHeight, sx: scrollX, sy: scrollY };
    return res;
  });
  console.log('PROBE2 ' + JSON.stringify(out));
});

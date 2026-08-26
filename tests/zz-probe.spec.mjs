// SONDA TEMPORANEA — da cancellare. Serve a capire come Chromium rende
// visibili/invisibili i vari modi di nascondere un riquadro.
import { test } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <div id="normal" style="width:300px;height:50px">visible box</div>
  <div id="offscreen" style="position:absolute;left:-9999px;top:0;width:300px;height:50px">off</div>
  <div id="transparent" style="opacity:0;width:300px;height:50px">transparent</div>
  <div id="visHidden" style="visibility:hidden;width:300px;height:50px">vis hidden</div>
  <div id="cvHidden" style="content-visibility:hidden;width:300px;height:50px"><span id="cvChild">child</span></div>
  <div id="belowFold" style="margin-top:3000px;width:300px;height:50px">below fold</div>
  <details id="det"><summary>more</summary><div id="detChild" style="width:300px;height:50px">hidden text</div></details>
  <div id="opacityParent" style="opacity:0"><div id="opacityChild" style="width:300px;height:50px">child</div></div>
  <div id="clipped" style="position:absolute;width:300px;height:50px;clip-path:inset(100%)">clipped</div>
</body></html>`;

test('sonda visibilita', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const out = await page.evaluate(() => {
    const ids = ['normal', 'offscreen', 'transparent', 'visHidden', 'cvHidden', 'cvChild', 'belowFold', 'detChild', 'opacityChild', 'clipped'];
    const res = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { res[id] = 'MISSING'; continue; }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      res[id] = {
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        contentVisibility: cs.contentVisibility,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        checkVisibility: typeof el.checkVisibility === 'function'
          ? el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })
          : 'n/a',
        offsetParent: !!el.offsetParent,
      };
    }
    res.__doc = {
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      innerW: window.innerWidth, innerH: window.innerHeight,
    };
    return res;
  });
  console.log('PROBE ' + JSON.stringify(out, null, 1));
});

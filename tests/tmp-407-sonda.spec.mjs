// SONDA TEMPORANEA (#407) — da cancellare prima della consegna.
// Cerca falsi positivi: elementi VUOTI (nessun componente chiuso dentro) che
// però fanno cadere il punto d'inserimento fuori da sé.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px;margin:0">
  <h1 id="plain">A plain heading</h1>
  <empty-box id="plainEmpty"></empty-box>
  <empty-box id="flexEmpty" style="display:flex"></empty-box>
  <empty-box id="gridEmpty" style="display:grid"></empty-box>
  <empty-box id="noSelect" style="user-select:none"></empty-box>
  <empty-box id="beforeContent" class="deco"></empty-box>
  <empty-box id="bgImage" style="background:linear-gradient(#fff,#000)"></empty-box>
  <empty-box id="inlineBlock" style="display:inline-block"></empty-box>
  <empty-box id="overflowHidden" style="overflow:hidden"></empty-box>
  <empty-box id="relPos" style="position:relative"></empty-box>
  <empty-box id="withBorder" style="border:2px solid #333"></empty-box>
  <empty-box id="openShadowNoText"></empty-box>
  <canvas-like id="canvasKid"><canvas width="100" height="40"></canvas></canvas-like>
  <style>
    empty-box, canvas-like { display:block; width:600px; height:60px; background:#eee; margin-bottom:6px; }
    empty-box.deco::before { content:''; display:block; height:40px; background:#999; }
  </style>
  <script>
    customElements.define('empty-box', class extends HTMLElement {});
    customElements.define('canvas-like', class extends HTMLElement {});
    const os = document.getElementById('openShadowNoText');
    os.attachShadow({ mode: 'open' }).innerHTML = '<div style="height:40px;background:#bbb"></div>';
  </script>
</body></html>`;

test('sonda', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const out = await page.evaluate(() => {
    const probePoint = (el, x, y) => {
      const hit = document.elementFromPoint(x, y);
      if (hit !== el) return 'hit:' + (hit ? hit.tagName + '#' + hit.id : 'null');
      const node = document.caretPositionFromPoint
        ? (document.caretPositionFromPoint(x, y) || {}).offsetNode
        : null;
      if (!node) return 'caret:null';
      return node === el ? 'self' : 'other:' + node.nodeName;
    };
    const res = {};
    for (const el of document.querySelectorAll('empty-box, canvas-like')) {
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const w = r.width;
      const marks = [];
      for (const x of [r.left + w / 2, r.left + w * 0.25, r.left + w * 0.75]) marks.push(probePoint(el, x, y));
      res[el.id] = marks.join(' ');
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 2));
  expect(true).toBe(true);
});

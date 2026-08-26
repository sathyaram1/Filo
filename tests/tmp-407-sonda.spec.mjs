// SONDA TEMPORANEA (#407) — da cancellare prima della consegna.
// Misura cosa rispondono elementFromPoint/caretPositionFromPoint nei quattro
// casi che contano per isClosedComponent().

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px;margin:0">
  <h1 id="plain">A plain heading</h1>
  <closed-card id="closedVisible"></closed-card>
  <empty-box id="emptyVisible"></empty-box>
  <empty-box id="emptyNoPointer" style="pointer-events:none"></empty-box>
  <closed-card id="closedNoPointer" style="pointer-events:none"></closed-card>
  <div style="height:4000px"></div>
  <empty-box id="emptyBelow"></empty-box>
  <closed-card id="closedBelow"></closed-card>
  <style>
    empty-box { display:block; width:600px; height:60px; background:#eee; }
    closed-card { display:block; width:600px; }
  </style>
  <script>
    customElements.define('empty-box', class extends HTMLElement {});
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<h2>Headline locked inside a closed component</h2>'
          + '<p>Body text nobody outside the component can read.</p>';
      }
    });
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
        : (document.caretRangeFromPoint ? (document.caretRangeFromPoint(x, y) || {}).startContainer : null);
      if (!node) return 'caret:null';
      return node === el ? 'self' : 'other:' + (node.nodeType === 3 ? 'text[' + String(node.nodeValue).slice(0, 20) + ']' : node.nodeName);
    };
    const res = {};
    for (const id of ['closedVisible', 'emptyVisible', 'emptyNoPointer', 'closedNoPointer', 'emptyBelow', 'closedBelow']) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const x = Math.min(r.left + r.width / 2, window.innerWidth - 2);
      const y = Math.min(Math.max(r.top + r.height / 2, 2), window.innerHeight - 2);
      res[id] = {
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        defined: el.matches(':defined'),
        shadowRoot: !!el.shadowRoot,
        children: el.children.length,
        text: (el.textContent || '').trim().length,
        scrollH: el.scrollHeight,
        probe: probePoint(el, x, y),
        caretApi: typeof document.caretPositionFromPoint === 'function' ? 'position' : 'range',
      };
    }
    res.viewport = [window.innerWidth, window.innerHeight];
    return res;
  });
  console.log(JSON.stringify(out, null, 2));
  expect(true).toBe(true);
});

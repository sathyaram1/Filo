import { test } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A plain heading outside any component</h1>
  <p>Paragraph before.</p>
  <closed-card id="txt"></closed-card>
  <p>Paragraph middle.</p>
  <deco-box id="deco"></deco-box>
  <p>Paragraph after.</p>
  <empty-closed id="emptyc"></empty-closed>
  <p>Paragraph end.</p>
  <style>deco-box, empty-closed { display:block; width:300px; height:60px; background:#ccc; } closed-card{display:block}</style>
  <script>
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<h2>Headline locked inside a closed component</h2><p>Body text nobody outside can read.</p>';
      }
    });
    customElements.define('deco-box', class extends HTMLElement {});
    customElements.define('empty-closed', class extends HTMLElement {
      connectedCallback() { const r = this.attachShadow({ mode: 'closed' }); r.innerHTML = '<div style="width:100%;height:100%;background:#a00"></div>'; }
    });
  </script>
</body></html>`;

test('sonda', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const out = await page.evaluate(() => {
    const res = {};
    for (const id of ['txt', 'deco', 'emptyc']) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      const cp = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
      const sel = getSelection(); sel.removeAllRanges(); sel.selectAllChildren(el); const st = sel.toString(); sel.removeAllRanges();
      const range = document.createRange(); range.selectNode(el);
      const sel2 = getSelection(); sel2.addRange(range); const st2 = sel2.toString(); sel2.removeAllRanges();
      res[id] = {
        innerText: el.innerText, textContent: el.textContent, selChildren: st, selNode: st2,
        cpNode: cp && cp.offsetNode && (cp.offsetNode.nodeName + ':' + (cp.offsetNode.id || '') + ':' + String(cp.offsetNode.nodeValue || '').slice(0, 20)), cpOff: cp && cp.offset,
        sw: el.scrollWidth, sh: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight,
        h: r.height,
      };
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
});

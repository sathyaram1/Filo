import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <div id="plain">Plain visible text here</div>
  <open-box id="ob"></open-box>
  <closed-box id="cb"></closed-box>
  <slot-box id="sb"><span id="slotted">Slotted light text</span></slot-box>
  <script>
    class OpenBox extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<h2 id="oh">Open shadow heading</h2><p id="op">Open shadow paragraph body.</p>';
      }
    }
    class ClosedBox extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'closed' });
        r.innerHTML = '<h2>Closed shadow heading</h2><p>Closed shadow paragraph body.</p>';
      }
    }
    class SlotBox extends HTMLElement {
      connectedCallback() {
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<div id="wrap">Wrapper text <slot></slot></div>';
      }
    }
    customElements.define('open-box', OpenBox);
    customElements.define('closed-box', ClosedBox);
    customElements.define('slot-box', SlotBox);
  </script>
</body></html>`;

test('probe shadow', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const info = await page.evaluate(() => {
    const q = (id) => document.getElementById(id);
    const out = {};
    out.bodyInnerTextHasClosed = (document.body.innerText || '').includes('Closed shadow');
    out.bodyInnerTextHasOpen = (document.body.innerText || '').includes('Open shadow');
    out.bodyTextContentHasOpen = (document.body.textContent || '').includes('Open shadow');
    out.obShadow = !!q('ob').shadowRoot;
    out.cbShadow = !!q('cb').shadowRoot;
    out.obInnerText = q('ob').innerText;
    out.cbInnerText = q('cb').innerText;
    out.cbTextContent = q('cb').textContent;
    out.cbChildNodes = q('cb').childNodes.length;
    out.obChildNodes = q('ob').childNodes.length;
    out.sbInnerText = q('sb').innerText;
    out.sbChildNodes = q('sb').childNodes.length;
    // computed style available on shadow elements?
    const oh = q('ob').shadowRoot.getElementById('oh');
    out.ohDisplay = window.getComputedStyle(oh).display;
    out.ohRect = JSON.stringify(oh.getBoundingClientRect().width);
    // does the Extract module see them today?
    const blocks = globalThis.SN_EXTRACT ? [] : null;
    return out;
  });
  console.log('PROBE', JSON.stringify(info, null, 2));
  expect(1).toBe(1);
});

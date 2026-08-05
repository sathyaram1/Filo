import { test, expect } from './fixtures/electron.mjs';

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAlWQMEXtHc5AAAAABJRU5ErkJggg==';

function pageHtml() {
  return `<!doctype html><html><body>
    <isolated-block></isolated-block>
    <script>
      class IsolatedBlock extends HTMLElement {
        constructor() {
          super();
          const root = this.attachShadow({ mode: 'open' });
          root.innerHTML = '<p id="s-text">Una frase nel blocco abbastanza lunga da poter essere selezionata.</p>';
        }
      }
      customElements.define('isolated-block', IsolatedBlock);
    </script>
  </body></html>`;
}

test('dbg shadow selection', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml());
  const info = await page.evaluate(() => {
    const host = document.querySelector('isolated-block');
    const root = host.shadowRoot;
    const p = root.getElementById('s-text');
    const range = document.createRange();
    range.selectNodeContents(p);
    const wsel = window.getSelection();
    wsel.removeAllRanges();
    wsel.addRange(range);
    const out = {
      rootHasGetSelection: typeof root.getSelection === 'function',
      winString: window.getSelection().toString(),
      winCollapsed: window.getSelection().isCollapsed,
      winRangeCount: window.getSelection().rangeCount,
    };
    if (typeof root.getSelection === 'function') {
      const rs = root.getSelection();
      out.rootString = rs.toString();
      out.rootCollapsed = rs.isCollapsed;
      out.rootRangeCount = rs.rangeCount;
    }
    return out;
  });
  console.log('DBG', JSON.stringify(info));
  expect(true).toBe(true);
});

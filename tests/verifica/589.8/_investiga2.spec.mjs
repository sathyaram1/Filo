import { test, expect } from '../../fixtures/electron.mjs';

const S = 'pw-Segreta-589-otto';
const cerca = `window.cerca = (q) => { getSelection().removeAllRanges(); return window.find(q, true, false, true); };`;

test('find matches input/textarea value?', async ({ openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><body>
    <input id="i" readonly style="width:300px">
    <textarea id="t" readonly style="width:300px"></textarea>
    <div id="host"></div>
    <script>
      document.getElementById('i').value = ${JSON.stringify(S)};
      document.getElementById('t').value = ${JSON.stringify(S)};
      const sr = document.getElementById('host').attachShadow({ mode: 'closed' });
      const inp = document.createElement('input'); inp.readOnly = true; inp.value = ${JSON.stringify(S)}; sr.appendChild(inp);
      ${cerca}</script></body></html>`);
  const p = await openTab(url); await p.waitForTimeout(300);
  console.log('INPUT_LIGHT', await p.evaluate((s) => window.cerca(s), S));
  expect(true).toBe(true);
});

test('CSP frame-src none blocks sandbox srcdoc iframe (DOM-created)?', async ({ openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="frame-src 'none'; child-src 'none'">
    </head><body>
    <script>
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = '<div id="s">'+${JSON.stringify(S)}+'</div>';
      f.style.cssText = 'width:300px;height:80px';
      let errore = false;
      f.addEventListener('load', () => {});
      document.body.appendChild(f);
      window.statoIframe = () => {
        let reso = false;
        try { reso = !!(f.contentWindow); } catch (_) {}
        // Rendering: se CSP blocca, il contentDocument resta about:blank vuoto.
        return { connesso: f.isConnected, haContentWindow: reso };
      };
      ${cerca}</script></body></html>`);
  const p = await openTab(url); await p.waitForTimeout(500);
  console.log('CSP_FIND', await p.evaluate((s) => window.cerca(s), S), 'STATO', JSON.stringify(await p.evaluate(() => window.statoIframe())));
  expect(true).toBe(true);
});

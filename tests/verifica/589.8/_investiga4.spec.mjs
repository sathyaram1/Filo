import { test, expect } from '../../fixtures/electron.mjs';

const S = 'pw-Segreta-589-otto';

// La pagina NON permette inline script a sé stessa: lo script di bootstrap sta in un file servito,
// così la pagina carica. La domanda è se lo script INLINE dentro il srcdoc sandbox gira comunque.
async function prova(openTab, testServer, csp) {
  const boot = testServer.html(''); // placeholder url just to have an origin; not used
  const url = testServer.html(`<!doctype html><html><head>
    ${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''}
    </head><body>
    <div id="log"></div>
    <script src="data:text/javascript,${encodeURIComponent(`
      window.__msgs = [];
      addEventListener('message', (e) => { window.__msgs.push(e.data); });
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = '<body><div id=d></div><scr'+'ipt>parent.postMessage("BOOT","*");document.getElementById("d").textContent=${JSON.stringify(JSON.stringify(S))}</scr'+'ipt></body>';
      f.style.cssText='width:300px;height:80px';
      document.body.appendChild(f);
      window.cerca = (q) => { getSelection().removeAllRanges(); return window.find(q, true, false, true); };
    `)}"></script>
  </body></html>`);
  const p = await openTab(url);
  await p.waitForTimeout(700);
  return p.evaluate((s) => ({ msgs: window.__msgs || 'no-boot-script', find: window.cerca ? window.cerca(s) : 'no-cerca' }), S);
}

test('srcdoc inline script sotto script-src self (no unsafe-inline)', async ({ openTab, testServer }) => {
  console.log('SELF', JSON.stringify(await prova(openTab, testServer, "script-src 'self' data:")));
  expect(true).toBe(true);
});
test('srcdoc inline script sotto script-src none', async ({ openTab, testServer }) => {
  console.log('NONE', JSON.stringify(await prova(openTab, testServer, "script-src data:")));
  expect(true).toBe(true);
});

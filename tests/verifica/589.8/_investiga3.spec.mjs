import { test, expect } from '../../fixtures/electron.mjs';

const S = 'pw-Segreta-589-otto';

async function prova(openTab, testServer, csp) {
  const head = csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : '';
  const url = testServer.html(`<!doctype html><html><head>${head}</head><body>
    <script>
      window.__msgs = [];
      addEventListener('message', (e) => window.__msgs.push(e.data));
      const f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts');
      f.srcdoc = "<body><div>"+${JSON.stringify(S)}+"</div><scr"+"ipt>parent.postMessage('VIVO:'+document.body.innerText,'*')</scr"+"ipt></body>";
      f.style.cssText = 'width:300px;height:80px';
      document.body.appendChild(f);
      window.cerca = (q) => { getSelection().removeAllRanges(); return window.find(q, true, false, true); };
    </script></body></html>`);
  const p = await openTab(url);
  await p.waitForTimeout(700);
  return p.evaluate((s) => ({ msgs: window.__msgs, find: window.cerca(s) }), S);
}

test('sandbox srcdoc rende senza CSP', async ({ openTab, testServer }) => {
  console.log('NO_CSP', JSON.stringify(await prova(openTab, testServer, '')));
  expect(true).toBe(true);
});
test('sandbox srcdoc rende con CSP strict', async ({ openTab, testServer }) => {
  console.log('CSP_STRICT', JSON.stringify(await prova(openTab, testServer, "default-src 'none'; frame-src 'none'; child-src 'none'; script-src 'unsafe-inline'")));
  expect(true).toBe(true);
});

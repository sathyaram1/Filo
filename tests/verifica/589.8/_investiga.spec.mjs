import { test, expect } from '../../fixtures/electron.mjs';

const S = 'pw-Segreta-589-otto';

test('find: closed shadow vs cross-origin iframe vs sandbox srcdoc', async ({ openTab, testServer }) => {
  const figlio = testServer.html(`<!doctype html><html><body><div id="x">${S}</div></body></html>`, { pubblico: true });
  const top = testServer.html(`<!doctype html><html><body style="padding:30px">
    <div id="host"></div>
    <iframe id="cross" src="${figlio}" style="width:300px;height:80px"></iframe>
    <iframe id="sbx" sandbox="allow-scripts" srcdoc="<div>${S}</div>" style="width:300px;height:80px"></iframe>
    <script>
      const sr = document.getElementById('host').attachShadow({ mode: 'closed' });
      sr.innerHTML = '<div>' + ${JSON.stringify(S)} + '</div>';
      window.cerca = (q) => { getSelection().removeAllRanges(); return window.find(q, true, false, true); };
    </script>
  </body></html>`);
  const page = await openTab(top);
  await page.waitForTimeout(500);
  const r = await page.evaluate((s) => ({
    shadowChiuso: window.cerca(s),
    innerText: document.body.innerText.includes(s),
  }), S);
  console.log('INVESTIGA', JSON.stringify(r));
  expect(true).toBe(true);
});

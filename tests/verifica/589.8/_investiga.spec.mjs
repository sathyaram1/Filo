import { test, expect } from '../../fixtures/electron.mjs';

const S = 'pw-Segreta-589-otto';
const cerca = `window.cerca = (q) => { getSelection().removeAllRanges(); return window.find(q, true, false, true); };`;

test('find pierces closed shadow?', async ({ openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><body><div id="host"></div><script>
    document.getElementById('host').attachShadow({ mode: 'closed' }).innerHTML = '<div>'+${JSON.stringify(S)}+'</div>';
    ${cerca}</script></body></html>`);
  const p = await openTab(url); await p.waitForTimeout(300);
  console.log('SHADOW_CHIUSO', await p.evaluate((s) => window.cerca(s), S), 'innerText', await p.evaluate((s)=>document.body.innerText.includes(s),S));
  expect(true).toBe(true);
});

test('find descends cross-origin iframe?', async ({ openTab, testServer }) => {
  const child = testServer.html(`<!doctype html><html><body><div>${S}</div></body></html>`, { pubblico: true });
  const url = testServer.html(`<!doctype html><html><body><iframe src="${child}" style="width:300px;height:80px"></iframe><script>${cerca}</script></body></html>`);
  const p = await openTab(url); await p.waitForTimeout(500);
  console.log('CROSS_ORIGIN', await p.evaluate((s) => window.cerca(s), S));
  expect(true).toBe(true);
});

test('find descends sandbox srcdoc iframe?', async ({ openTab, testServer }) => {
  const url = testServer.html(`<!doctype html><html><body><iframe sandbox="allow-scripts" srcdoc="<div>${S}</div>" style="width:300px;height:80px"></iframe><script>${cerca}</script></body></html>`);
  const p = await openTab(url); await p.waitForTimeout(500);
  console.log('SANDBOX_SRCDOC', await p.evaluate((s) => window.cerca(s), S));
  expect(true).toBe(true);
});

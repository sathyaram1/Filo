import { test, expect } from '../fixtures/electron.mjs';
test('probe', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><p>ciao</p><div id="h"></div></body></html>`);
  const r = await page.evaluate(async () => {
    const out = {};
    const host = document.getElementById('h');
    host.style.cssText = 'all:initial;display:contents';
    const sh = host.attachShadow({ mode: 'closed' });
    const ta = document.createElement('textarea'); ta.value = 'alfa beta gamma delta'; sh.appendChild(ta);
    const d = document.createElement('div'); d.className = 'interno'; d.textContent = 'uno due tre quattro cinque'; sh.appendChild(d);
    await new Promise((r) => setTimeout(r, 100));
    getSelection().removeAllRanges();
    out.f1 = window.find('uno');
    const s = getSelection();
    out.anchorIsHost = s.anchorNode === host;
    out.anchorName = s.anchorNode && (s.anchorNode.nodeName + '/' + (s.anchorNode.className || ''));
    try { const rg = s.getRangeAt(0); out.rangeStart = rg.startContainer === host ? 'host' : (rg.startContainer.nodeName + ':' + rg.startContainer.textContent); } catch (e) { out.rangeErr = String(e); }
    try { s.modify('extend', 'forward', 'line'); out.afterModify = String(s); } catch (e) { out.modErr = String(e); }
    getSelection().removeAllRanges();
    out.f2 = window.find('alfa');
    const s2 = getSelection();
    out.ta_anchor = s2.anchorNode && s2.anchorNode.nodeName;
    try { s2.modify('extend', 'forward', 'line'); out.ta_afterModify = String(s2); } catch (e) { out.modErr2 = String(e); }
    out.focused = document.activeElement === host;
    return out;
  });
  console.log(JSON.stringify(r));
});

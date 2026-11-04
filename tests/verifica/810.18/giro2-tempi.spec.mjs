import { test } from '../../fixtures/electron.mjs';
const CASELLE = `<table>${'<tr><td><input type="checkbox"></td><td>ordine</td></tr>'.repeat(3000)}</table>`;
const CHIUSO = `<cerca-c></cerca-c><script>customElements.define('cerca-c', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<input type="search" value="scarpe">'; } });</script>`;
test('tempi', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Ordini</title></head><body>${CHIUSO}${CASELLE}
      <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(9000));</script></body></html>`);
  await new Promise((r) => setTimeout(r, 1000));
  const out = await app.evaluate(async ({ webContents }, percorso) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(percorso));
    const dbg = wc.debugger; dbg.attach('1.3');
    const cmd = (m, p = {}) => dbg.sendCommand(m, p);
    let eventi = 0, chiuse = 0; dbg.on('message', (_e, m, p) => { eventi++; if (m === 'DOM.setChildNodes') JSON.stringify(p).replace(/"shadowRootType":"closed"/g, () => { chiuse++; return ''; }); });
    let fermo = 0, prec = Date.now();
    const iv = setInterval(() => { const n = Date.now(); fermo = Math.max(fermo, n - prec); prec = n; }, 10);
    const t = [Date.now()];
    await cmd('DOM.getDocument', { depth: 0 });
    const { searchId, resultCount } = await cmd('DOM.performSearch', { query: '<input>', includeUserAgentShadowDOM: false });
    t.push(Date.now());
    const { nodeIds } = await cmd('DOM.getSearchResults', { searchId, fromIndex: 0, toIndex: resultCount });
    t.push(Date.now());
    const f1 = fermo; fermo = 0;
    await Promise.all(nodeIds.map(async (nodeId) => { const { object } = await cmd('DOM.resolveNode', { nodeId, objectGroup: 'g' }); await cmd('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){return 1}', returnByValue: true }); }));
    t.push(Date.now());
    clearInterval(iv);
    dbg.detach();
    return { resultCount, ricerca: t[1] - t[0], risultati: t[2] - t[1], risolvi: t[3] - t[2], fermoRisultati: f1, fermoRisolvi: fermo, eventi, chiuse };
  }, new URL(page.url()).pathname);
  console.log(JSON.stringify(out));
});

// Verifica #810.18, giro 3: esplorazione.

import { test, expect } from '../../fixtures/electron.mjs';

const componenteChiuso = `<carta-chiusa></carta-chiusa><script>
  customElements.define('carta-chiusa', class extends HTMLElement { constructor() { super();
    const r = this.attachShadow({ mode: 'closed' }); window.__radice = r;
    r.innerHTML = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" '
      + 'style="width:280px;font-size:18px;outline:0;caret-color:transparent">'; } });
</script>`;

const modulo = (campo) => `<!doctype html><html><head><title>Cassa</title></head><body><h1>Cassa</h1>
  <form><div>${campo}</div><button type="button">Paga</button></form></body></html>`;

async function misuraLaRicerca(app, percorso, volte = 3) {
  return app.evaluate(async ({ webContents }, [percorso, volte]) => {
    const rq = process.mainModule.require;
    const M = rq(rq('node:path').join(process.cwd(), 'src/main/services/campiNeiRiquadri.js'));
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(percorso));
    const durate = [];
    let fermo = 0, prec = Date.now();
    const iv = setInterval(() => { const n = Date.now(); fermo = Math.max(fermo, n - prec); prec = n; }, 10);
    for (let i = 0; i < volte; i++) {
      const t = Date.now();
      const r = await M.campiSegretiFuoriPagina(wc);
      durate.push({ ms: Date.now() - t, campi: r.campi.length, nonCoperti: r.nonCoperti });
    }
    clearInterval(iv);
    return { durate, fermo };
  }, [percorso, volte]);
}

for (const [nome, ms] of [['un campo che compare e scompare ogni 2 ms', 2], ['un campo che compare e scompare ogni 7 ms', 7]]) {
  test(`gara: ${nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(180_000);
    const page = await testServer.openReady(openTab, modulo(`${componenteChiuso}<div id="z"></div>
      <script>let on = false; setInterval(() => { on = !on; z.innerHTML = on ? '<input name="quantita">' : ''; }, ${ms});</script>`));
    await expect.poll(() => page.evaluate(() => Boolean(window.__radice)), { timeout: 10_000 }).toBe(true);
    await page.evaluate(() => { window.__radice.querySelector('input').value = '4111111111111111'; });
    const esito = await misuraLaRicerca(app, new URL(page.url()).pathname, 40);
    const scoperte = esito.durate.filter((d) => !d.nonCoperti && d.campi === 0).length;
    console.log(nome, 'scoperte', scoperte, JSON.stringify(esito.durate.slice(0, 5)));
    expect(scoperte).toBe(0);
  });
}

test('pagina grande con la carta in un componente chiuso', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const riquadri = Array.from({ length: 20 }, (_, i) => testServer.html(`<!doctype html><html><body>
    ${'<div><span>x</span><a href="#">y</a></div>'.repeat(1500)}<p>r${i}</p></body></html>`, { pubblico: true }));
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Negozio</title></head><body>
    <h1>Cassa</h1>${componenteChiuso}
    <script>document.write('<div><p>scarpa <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(9000));</script>
    ${riquadri.map((u) => `<iframe src="${u}" width="200" height="100"></iframe>`).join('')}</body></html>`);
  await expect.poll(() => page.frames().length, { timeout: 30_000 }).toBeGreaterThan(20);
  await page.evaluate(() => { window.__radice.querySelector('input').value = '4111111111111111'; });
  const esito = await misuraLaRicerca(app, new URL(page.url()).pathname, 3);
  console.log('grande carta', JSON.stringify(esito));
  expect(esito.durate.every((d) => d.campi === 1 || d.nonCoperti)).toBe(true);
});

const COMMENTI = `<div id="t">${'<div class="c"><div><div><p>commento</p></div><div><form><div><textarea></textarea></div><button>Rispondi</button></form></div></div></div>'.repeat(3000)}</div>`;
const CERCA_CHIUSO = `<cerca-chiuso></cerca-chiuso><script>customElements.define('cerca-chiuso', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<input type="search" value="scarpe">'; } });</script>`;
for (const [nome, extra] of [
  ['tremila moduli di risposta e un componente chiuso col campo di ricerca', CERCA_CHIUSO + COMMENTI],
  ['tremila moduli di risposta e un riquadro senza script', `<iframe sandbox srcdoc="<input name='email'>"></iframe>` + COMMENTI],
  ['tremila moduli di risposta', COMMENTI],
]) {
  test(`costo: ${nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(180_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Discussione</title></head><body>${extra}
      <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(7000));</script></body></html>`);
    const esito = await misuraLaRicerca(app, new URL(page.url()).pathname);
    console.log(nome, JSON.stringify(esito));
    expect(Math.max(...esito.durate.map((d) => d.ms))).toBeLessThan(1000);
    expect(esito.fermo).toBeLessThan(300);
  });
}

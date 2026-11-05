// Verifica #810.18, giro 3: la ricerca dei campi nei componenti chiusi misurata dal lato dell'utente (attesa per foto,
// Filo fermo, carta coperta), sulle porte rimaste: conti che non tornano con molti campi, carta vera su una pagina
// grande, pagina che aggiunge e toglie un campo.

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

// Una discussione lunga: un modulo di risposta per commento, annidato come nei siti veri.
const COMMENTI = `<div id="t">${'<div class="c"><div><div><p>commento</p></div><div><form><div><textarea></textarea></div><button>Rispondi</button></form></div></div></div>'.repeat(3000)}</div>`;
const CERCA_CHIUSO = `<cerca-chiuso></cerca-chiuso><script>customElements.define('cerca-chiuso', class extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: 'closed' }).innerHTML = '<input type="search" value="scarpe">'; } });</script>`;
for (const [nome, extra] of [
  ['un componente chiuso con il solo campo di ricerca', CERCA_CHIUSO],
  ['un riquadro con gli script spenti con un campo per l’email', `<iframe sandbox srcdoc="<form>Iscriviti <input name='email'></form>"></iframe>`],
]) {
  test(`r1 discussione di tremila moduli di risposta con ${nome}: la foto non aspetta e Filo non si ferma`, async ({ app, openTab, testServer }) => {
    test.setTimeout(180_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Discussione</title></head><body>${extra}${COMMENTI}
      <script>document.write('<div><p>testo <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(7000));</script></body></html>`);
    const esito = await misuraLaRicerca(app, new URL(page.url()).pathname);
    console.log(nome, JSON.stringify(esito));
    expect(esito.durate.every((d) => d.campi === 0)).toBe(true);
    expect(Math.max(...esito.durate.map((d) => d.ms)), 'ogni foto dell’assistente aspetta la ricerca dei campi').toBeLessThan(500);
    expect(esito.fermo, 'Filo resta fermo mentre cerca i campi').toBeLessThan(300);
  });
}

for (const [nome, ripetizioni, riquadri] of [['novantamila elementi e venti riquadri', 9000, 20], ['trentamila elementi', 4000, 0]]) {
  test(`r2 pagina di ${nome} con la carta scritta in un componente chiuso: la carta è coperta e Filo non si ferma`, async ({ app, openTab, testServer }) => {
    test.setTimeout(180_000);
    const indirizzi = Array.from({ length: riquadri }, (_, i) => testServer.html(`<!doctype html><html><body>
      ${'<div><span>x</span><a href="#">y</a></div>'.repeat(1500)}<p>r${i}</p></body></html>`, { pubblico: true }));
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Negozio</title></head><body>
      <h1>Cassa</h1>${componenteChiuso}
      <script>document.write('<div><p>scarpa <b>uno</b> <i>due</i></p><ul><li>a</li><li>b</li></ul></div>'.repeat(${ripetizioni}));</script>
      ${indirizzi.map((u) => `<iframe src="${u}" width="200" height="100"></iframe>`).join('')}</body></html>`);
    await expect.poll(() => page.frames().length, { timeout: 30_000 }).toBe(riquadri + 1);
    await page.evaluate(() => { window.__radice.querySelector('input').value = '4111111111111111'; });
    const esito = await misuraLaRicerca(app, new URL(page.url()).pathname, 3);
    console.log(nome, JSON.stringify(esito));
    expect(esito.durate.filter((d) => d.campi !== 1 && !d.nonCoperti).length, 'foto con la carta scoperta, su tre').toBe(0);
    expect(esito.fermo, 'Filo resta fermo mentre cerca i campi').toBeLessThan(500);
  });
}

test('r3 pagina che aggiunge e toglie un campo ogni 2 ms: la carta del componente chiuso è coperta in ogni foto', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, modulo(`${componenteChiuso}<div id="z"></div>
    <script>let on = false; setInterval(() => { on = !on; z.innerHTML = on ? '<input name="quantita">' : ''; }, 2);</script>`));
  await expect.poll(() => page.evaluate(() => Boolean(window.__radice)), { timeout: 10_000 }).toBe(true);
  await page.evaluate(() => { window.__radice.querySelector('input').value = '4111111111111111'; });
  const esito = await misuraLaRicerca(app, new URL(page.url()).pathname, 120);
  const scoperte = esito.durate.filter((d) => !d.nonCoperti && d.campi === 0).length;
  console.log('scoperte su 120', scoperte);
  expect(scoperte, 'foto con la carta scoperta, su centoventi').toBe(0);
});

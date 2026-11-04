// Verifica #810.18, giro 2, rilievo 1: il numero della carta in un componente chiuso resta coperto anche mentre la
// pagina toglie e rimette dei campi (un elenco che si ridisegna), a ogni foto per l'assistente.

import { test, expect } from '../../fixtures/electron.mjs';

const CHIUSO = `<carta-chiusa></carta-chiusa><script>
  customElements.define('carta-chiusa', class extends HTMLElement { constructor() { super();
    const r = this.attachShadow({ mode: 'closed' });
    r.innerHTML = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" value="4111111111111111" style="width:280px">'; } });
</script>`;

test('r1 il numero della carta nel componente chiuso è coperto in ogni foto, anche con la pagina che ridisegna i suoi campi', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Cassa</title></head><body>${CHIUSO}
    <div id="z"></div><script>let on = false; setInterval(() => { on = !on; z.innerHTML = on ? '<input>'.repeat(50) : ''; }, 2);</script></body></html>`);
  await new Promise((r) => setTimeout(r, 1000));
  const coperti = await app.evaluate(async ({ webContents }, percorso) => {
    const rq = process.mainModule.require;
    const M = rq(rq('node:path').join(process.cwd(), 'src/main/services/campiNeiRiquadri.js'));
    const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(percorso));
    const out = [];
    for (let i = 0; i < 30; i++) {
      const r = await M.campiSegretiFuoriPagina(wc);
      out.push(r.nonCoperti ? 'ferma' : r.campi.length);
    }
    return out;
  }, new URL(page.url()).pathname);
  expect(coperti.filter((c) => c === 0), `foto con la carta scoperta su 30: ${JSON.stringify(coperti)}`).toEqual([]);
});

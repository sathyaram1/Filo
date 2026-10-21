// Verifica #810.7, giro 3, rilievo 2: il numero di carta in un campo dentro un componente chiuso della pagina si
// legge nell'immagine che va al modello.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, superaAvviso, apriAiuto, chiedi, ultimaImmagine, pixelDiversi } from './aiuti.mjs';

test('carta in un campo dentro un componente chiuso: nell’immagine è coperta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagamento</title></head><body>
    <h1>Pagamento</h1><form><carta-chiusa></carta-chiusa><button type="button">Paga</button></form><script>
    customElements.define('carta-chiusa', class extends HTMLElement { constructor() { super();
      const r = this.attachShadow({ mode: 'closed' }); window.__radice = r;
      r.innerHTML = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" '
        + 'style="width:280px;font-size:18px;outline:0;caret-color:transparent">'; } });
  </script></body></html>`);
  await superaAvviso(page);
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  await apriAiuto(shell, page);
  const immagini = [];
  for (const [i, valore] of ['4111 1111 1111 1111', '5500 0000 0000 0004'].entries()) {
    await page.evaluate((v) => { window.__radice.querySelector('input').value = v; }, valore);
    await chiedi(app, page, 'aiutami a pagare', i + 1);
    immagini.push(await ultimaImmagine(app));
  }
  expect(immagini[0]).toMatch(/^data:image\//);
  const r = await page.evaluate(() => {
    const b = window.__radice.querySelector('input').getBoundingClientRect();
    return { left: b.left + 3, top: b.top + 3, width: b.width - 6, height: b.height - 6 };
  });
  expect(await pixelDiversi(page, immagini, r), 'il numero si legge nell’immagine').toBe(0);
});

// Verifica #810.7, giro 2, rilievo 2: il numero di carta in un campo dentro un componente della pagina (ombra) si
// legge nell'immagine che va al modello.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, superaAvviso, apriAiuto, chiedi, ultimaImmagine, pixelDiversi } from './aiuti.mjs';

const pagina = (corpo) => `<!doctype html><html><head><title>Pagamento</title></head><body><h1>Pagamento</h1>
  <form>${corpo}<button type="button">Paga</button></form></body></html>`;

test('carta in un campo dentro un componente della pagina (ombra): nell’immagine è coperta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const corpo = `<carta-pagamento id="cp"></carta-pagamento><script>
    customElements.define('carta-pagamento', class extends HTMLElement { constructor() { super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px">'; } });
  </script>`;
  const page = await testServer.openReady(openTab, pagina(corpo));
  await superaAvviso(page);
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  await apriAiuto(shell, page);
  const campo = page.locator('carta-pagamento input');
  const immagini = [];
  for (const [i, valore] of ['4111 1111 1111 1111', '5500 0000 0000 0004'].entries()) {
    await campo.fill(valore);
    await chiedi(app, page, 'aiutami a pagare', i + 1);
    immagini.push(await ultimaImmagine(app));
  }
  expect(immagini[0]).toMatch(/^data:image\//);
  const r = await campo.evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left + 3, top: b.top + 3, width: b.width - 6, height: b.height - 6 }; });
  expect(await pixelDiversi(page, immagini, r), 'il numero si legge nell’immagine').toBe(0);
});

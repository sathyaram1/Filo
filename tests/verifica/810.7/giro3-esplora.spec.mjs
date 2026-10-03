// Verifica #810.7, giro 3: esplorazione.

import { test, expect } from '../../fixtures/electron.mjs';
import { preparaModelli, modelloFinto, superaAvviso, apriAiuto, chiedi, arrivato, ultimaImmagine, pixelDiversi } from './aiuti.mjs';

const pagina = (corpo) => `<!doctype html><html><head><title>Accesso</title></head><body><h1>Accesso</h1>
  <form>${corpo}<button type="button">Paga</button></form></body></html>`;
const RISPOSTA = JSON.stringify({ text: 'Premi «Paga».', status: 'done' });

async function dueImmagini(app, shell, page, scrivi) {
  await preparaModelli(app);
  await modelloFinto(app, RISPOSTA);
  await apriAiuto(shell, page);
  const immagini = [];
  for (const [i, v] of ['4111 1111 1111 1111', '5500 0000 0000 0004'].entries()) {
    await scrivi(v);
    await chiedi(app, page, 'aiutami', i + 1);
    immagini.push(await ultimaImmagine(app));
  }
  expect(immagini[0]).toMatch(/^data:image\//);
  return immagini;
}

test('A ombra chiusa: carta nell’immagine', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const corpo = `<carta-chiusa></carta-chiusa><script>
    customElements.define('carta-chiusa', class extends HTMLElement { constructor() { super();
      const r = this.attachShadow({ mode: 'closed' }); window.__r = r;
      r.innerHTML = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px;outline:0;caret-color:transparent">'; } });
  </script>`;
  const page = await testServer.openReady(openTab, pagina(corpo));
  await superaAvviso(page);
  const imm = await dueImmagini(app, shell, page, (v) => page.evaluate((v) => { const i = window.__r.querySelector('input'); i.value = v; }, v));
  const r = await page.evaluate(() => { const b = window.__r.querySelector('input').getBoundingClientRect(); return { left: b.left + 3, top: b.top + 3, width: b.width - 6, height: b.height - 6 }; });
  expect(await pixelDiversi(page, imm, r)).toBe(0);
});

test('B password resa visibile, etichetta non legata, nome «pass»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<div>Password</div><input id="c" name="pass" type="password"> <button type="button" id="occhio" onclick="c.type=\'text\'">Mostra</button>'));
  await superaAvviso(page);
  await page.fill('#c', 'Gatto.Rosso.77');
  await page.click('#occhio');
  await preparaModelli(app);
  await modelloFinto(app, RISPOSTA);
  await apriAiuto(shell, page);
  await chiedi(app, page, 'non riesco ad entrare', 1);
  expect(await arrivato(app, page)).not.toContain('Gatto.Rosso');
});

test('C codice monouso in un campo solo senza nome', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Inserisci il codice che ti abbiamo mandato via SMS</p><input id="c" maxlength="6" inputmode="numeric">'));
  await page.fill('#c', '739146');
  await preparaModelli(app);
  await modelloFinto(app, RISPOSTA);
  await apriAiuto(shell, page);
  await chiedi(app, page, 'non funziona', 1);
  expect(await arrivato(app, page)).not.toContain('739146');
});

test('D anteprima della carta che ripete il numero', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<div id="anteprima" style="font-size:20px;width:300px;height:30px"></div><label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" oninput="anteprima.textContent=this.value">'));
  await superaAvviso(page);
  const imm = await dueImmagini(app, shell, page, (v) => page.fill('#c', v));
  const b = await page.locator('#anteprima').boundingBox();
  console.log('anteprima pixel diversi', await pixelDiversi(page, imm, { left: b.x, top: b.y, width: b.width, height: b.height }));
});

test('E password resa visibile in un riquadro di un altro sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:0;background:#fff">
    <label for="p">Password</label><input id="p" type="text" style="width:240px;font-size:20px;border:0;outline:0;caret-color:transparent"></body></html>`, { pubblico: true });
  const page = await testServer.openReady(openTab, pagina(`<iframe id="f" src="${riquadro}" style="width:340px;height:40px;border:0"></iframe>`));
  const campo = page.frameLocator('#f').locator('#p');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  const imm = await dueImmagini(app, shell, page, (v) => campo.fill(v));
  const b = await campo.boundingBox();
  expect(await pixelDiversi(page, imm, { left: b.x + 2, top: b.y + 2, width: b.width - 4, height: b.height - 4 })).toBe(0);
});

test('F carta in riquadro dentro un riquadro (due livelli, altro sito)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const interno = testServer.html(`<!doctype html><html><body style="margin:0;background:#fff">
    <input id="n" autocomplete="cc-number" style="width:300px;font-size:20px;border:0;outline:0;caret-color:transparent"></body></html>`, { pubblico: true });
  const esterno = testServer.html(`<!doctype html><html><body style="margin:0;background:#fff;padding:10px">
    <iframe id="g" src="${interno}" style="width:320px;height:40px;border:0"></iframe></body></html>`);
  const page = await testServer.openReady(openTab, pagina(`<iframe id="f" src="${esterno}" style="width:360px;height:70px;border:0"></iframe>`));
  const campo = page.frameLocator('#f').frameLocator('#g').locator('#n');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  const imm = await dueImmagini(app, shell, page, (v) => campo.fill(v));
  const b = await campo.boundingBox();
  expect(await pixelDiversi(page, imm, { left: b.x + 2, top: b.y + 2, width: b.width - 4, height: b.height - 4 })).toBe(0);
});

test('G pagina ingrandita: carta coperta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px;font-size:18px;outline:0;caret-color:transparent">'));
  await superaAvviso(page);
  await app.evaluate(({ webContents }) => { for (const wc of webContents.getAllWebContents()) if (/127\.0\.0\.1/.test(wc.getURL())) wc.setZoomFactor(1.5); });
  await page.waitForTimeout(500);
  const imm = await dueImmagini(app, shell, page, (v) => page.fill('#c', v));
  const b = await page.locator('#c').boundingBox();
  expect(await pixelDiversi(page, imm, { left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 })).toBe(0);
});

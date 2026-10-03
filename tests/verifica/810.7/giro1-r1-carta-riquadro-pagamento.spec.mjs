// Verifica #810.7, giro 1, rilievo 1: il numero di carta scritto nel riquadro di pagamento di un altro sito (il modo
// più comune di pagare con la carta) arriva leggibile nell'immagine della pagina che va al modello dell'assistente.

import { test, expect } from '../../fixtures/electron.mjs';
import { CARTE, modulo, preparaModelli, modelloFinto, superaAvviso, apriAiuto, chiedi, ultimaImmagine, pixelDiversi } from './aiuti.mjs';

test('il numero di carta nel riquadro di pagamento incorporato arriva coperto nell’immagine', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const riquadro = testServer.html(`<!doctype html><html><body style="margin:0;background:#fff">
    <input id="n" autocomplete="cc-number" placeholder="1234 1234 1234 1234"
      style="width:300px;font-size:20px;border:0;outline:0;caret-color:transparent"></body></html>`, { pubblico: true });
  const page = await testServer.openReady(openTab,
    modulo(`<label>Carta</label><iframe id="f" src="${riquadro}" style="width:340px;height:40px;border:0"></iframe>`));
  await superaAvviso(page);
  const campo = page.frameLocator('#f').locator('#n');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  await apriAiuto(shell, page);

  const immagini = [];
  for (const [i, carta] of CARTE.entries()) {
    await campo.fill(carta);
    await chiedi(app, page, 'aiutami a pagare', i + 1);
    immagini.push(await ultimaImmagine(app));
  }
  expect(immagini[0], 'al modello deve arrivare l’immagine della pagina').toMatch(/^data:image\//);
  const r0 = await page.locator('#f').boundingBox();
  const diversi = await pixelDiversi(page, immagini, { left: r0.x + 2, top: r0.y + 2, width: 300, height: r0.height - 4 });
  expect(diversi, 'il numero di carta scritto nel riquadro di pagamento si legge nell’immagine che va al modello').toBe(0);
});

// Verifica #810.7, giro 1, rilievo 2: il campo della carta è riconosciuto solo dal nome che gli dà il sito. Chiamato
// «cc-number» senza etichetta legata, o «Numero» dentro il riquadro «Carta di credito», il numero arriva al modello.

import { test, expect } from '../../fixtures/electron.mjs';
import { CARTE, modulo, preparaModelli, modelloFinto, superaAvviso, apriAiuto, chiedi, arrivato, ultimaImmagine, pixelDiversi } from './aiuti.mjs';

test('campo «cc-number» con la scritta accanto non legata: il numero non è nella descrizione della pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab,
    modulo('<div>Numero della carta</div><input id="cc-number" name="cc-number" inputmode="numeric">'));
  await superaAvviso(page);
  await page.fill('#cc-number', CARTE[0]);
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  await apriAiuto(shell, page);
  await chiedi(app, page, 'aiutami a pagare', 1);
  expect(await arrivato(app, page), 'il numero della carta è arrivato al modello').not.toContain('4111 1111');
});

test('campo «Numero» nel riquadro «Carta di credito»: il numero arriva coperto nell’immagine', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, modulo('<fieldset><legend>Carta di credito</legend><label for="n">Numero</label> '
    + '<input id="n" name="number" inputmode="numeric" style="width:300px;font-size:20px;outline:0;caret-color:transparent"></fieldset>'));
  await superaAvviso(page);
  await preparaModelli(app);
  await modelloFinto(app, JSON.stringify({ text: 'Premi «Paga».', status: 'done' }));
  await apriAiuto(shell, page);
  const immagini = [];
  for (const [i, carta] of CARTE.entries()) {
    await page.fill('#n', carta);
    await chiedi(app, page, 'aiutami a pagare', i + 1);
    immagini.push(await ultimaImmagine(app));
  }
  expect(immagini[0]).toMatch(/^data:image\//);
  const b = await page.locator('#n').boundingBox();
  const diversi = await pixelDiversi(page, immagini, { left: b.x + 3, top: b.y + 3, width: b.width - 6, height: b.height - 6 });
  expect(diversi, 'il numero scritto nel campo si legge nell’immagine che va al modello').toBe(0);
});

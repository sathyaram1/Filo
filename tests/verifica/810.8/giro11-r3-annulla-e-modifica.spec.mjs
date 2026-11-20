// Verifica #810.8 giro 11: la carta dell'utente rimessa nel campo dall'annulla del browser, o dalla Modifica di Filo,
// non resta fra i segreti letti.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, clicca, scrivi } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { CARTA, PAGAMENTO, compatta, modelli, oltreLAvviso, apriAiuto, chiedi, letti, dopoUnRiavvio } from './aiuti.mjs';

test('r3 la carta rimessa con Ctrl+Z dopo un Backspace non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGAMENTO('<label for="c">Numero della carta</label><input id="c">'));
  await oltreLAvviso(app);
  await modelli(app);
  await page.locator('#c').click();
  await page.keyboard.type(CARTA, { delay: 20 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+Z');
  await expect(page.locator('#c')).toHaveValue(CARTA);
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'aiutami a finire il pagamento');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain('264087');
  expect(await dopoUnRiavvio(app), 'la carta è rimasta fra i segreti letti').not.toContain(compatta(CARTA));
});

test('r3 la carta che l’utente fa aggiungere alla mail dalla Modifica non resta fra i segreti letti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const testo = `Ciao Marco, la mia carta è ${CARTA}. A presto`;
  const page = await testServer.openReady(openTab, PAGAMENTO('<textarea id="m" style="width:500px;height:80px"></textarea>'));
  await oltreLAvviso(app);
  await modelli(app, { riscrittura: testo });
  await page.locator('#m').click();
  await page.keyboard.type('Ciao Marco, a presto', { delay: 10 });
  await page.evaluate(() => { const t = document.querySelector('#m'); t.focus(); t.select(); });
  await page.locator('#m').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(page).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox-instruction')).not.toBeNull();
  const dove = await scrivi(app, page, '.sn-editbox-instruction', `aggiungi in fondo il numero della mia carta ${CARTA}`);
  await dove.keyboard.press('Enter');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '', { timeout: 20_000 }).toContain(CARTA);
  await clicca(app, page, '.sn-editbox-replace');
  await expect(page.locator('#m')).toHaveValue(testo);
  const aiuto = await apriAiuto(app, shell, page);
  await chiedi(aiuto, 'correggi il messaggio');
  await expect.poll(() => letti(app), { timeout: 10_000 }).toContain('264087');
  expect(await dopoUnRiavvio(app), 'la carta è rimasta fra i segreti letti').not.toContain(compatta(CARTA));
});

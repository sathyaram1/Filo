// Giro di verifica locale del ramo claude/link-invito — giro 6.
//
// Le strade equivalenti, che nessun giro passato aveva guardato. In Filo il
// tasto destro è la strada che risponde a «voglio fare qualcosa QUI»: su un
// collegamento d'invito, dentro Filo, la cosa che uno vuole fare è portarlo
// dentro. Qui si guarda cosa offre il tasto destro su quel collegamento.
//
// Scritto da chi verifica, non da chi ha fatto il lavoro.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>chat</title></head>
<body style="margin:0;font:16px sans-serif;padding:40px">
<p>Anna: ciao! ecco il mio invito a Filo</p>
<p><a id="invito" href="https://filo.red/i/ABCD-EFGH">https://filo.red/i/ABCD-EFGH</a></p>
</body></html>`;

test('il tasto destro su un collegamento d’invito offre di portarlo dentro Filo', async ({ openTab, testServer }) => {
  test.setTimeout(120000);

  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#invito').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 20000 });

  const voci = (await menu.innerText()).toLowerCase();
  expect(
    /riscatt|invito|crediti/.test(voci),
    `il menu del tasto destro sul collegamento d’invito offre solo: ${voci.replace(/\s+/g, ' · ')}`,
  ).toBe(true);
});

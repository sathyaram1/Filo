// #2052 giro 1 — il testo che torna in un campo arrivato tardi non sposta chi sta scrivendo altrove nella pagina.

import { test, expect } from '../../fixtures/electron.mjs';

// La casella arriva tre secondi dopo la pagina, come in un sito fatto di script; l'editor ricco c'è subito.
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Tardi</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
  <div id="ce" contenteditable="true" style="width:600px;min-height:80px;border:1px solid #999"></div>
  <div id="posto"></div>
  <script>
    setTimeout(() => {
      document.getElementById('posto').innerHTML = '<textarea id="ta" name="commento" style="display:block;margin-top:10px;width:600px;height:100px"></textarea>';
    }, 3000);
  </script>
</body>`;

function quanti(app) {
  return app.evaluate(async () => {
    const rq = process.mainModule.require;
    const T = rq(rq('node:path').join(process.cwd(), 'src/main/services/testoDeiCampi.js'));
    return (await T.stato()).campi;
  });
}

test('r1 mentre si scrive in un editor ricco, il testo che torna nella casella arrivata tardi non sposta il cursore', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('#ta').click({ timeout: 8000 });
  await page.keyboard.type('commento salvato');
  await expect.poll(() => quanti(app), { timeout: 8000 }).toBe(1);

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.locator('#ce').click();
  await page.keyboard.type('Primo pezzo ');
  await expect.poll(() => page.locator('#ta').inputValue().catch(() => ''), { timeout: 10_000 }).toBe('commento salvato');
  await page.keyboard.type('secondo pezzo');
  await expect(page.locator('#ce')).toHaveText('Primo pezzo secondo pezzo');
});

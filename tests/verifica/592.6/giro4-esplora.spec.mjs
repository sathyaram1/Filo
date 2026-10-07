// Verifica #592.6 — giro 4, esplorazione: aspetto del popup sopra la scheda e attesa della prima domanda.
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(90_000);

const chiedi = (app, host, testo) => nelMondoDiFilo(app, host, `(() => {
  globalThis.__t0 = performance.now(); globalThis.__l = null;
  SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', text: ${JSON.stringify(testo)} }).then((ok) => { globalThis.__l = ok; });
  return 1; })()`);

test('aspetto chiaro e scuro, attesa della prima domanda', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<body style="background:#2a6;margin:0"><h1 style="padding:40px">Pagina verde</h1></body>');
  const host = new URL(page.url()).hostname;
  const t0 = Date.now();
  await chiedi(app, host, 'Filo vuole impostare: Tema → Scuro.');
  let vista = await confermaSopraPagina(app);
  console.log('PRIMA DOMANDA ms', Date.now() - t0);
  await new Promise((r) => setTimeout(r, 700));
  await vista.screenshot({ path: 'tests/.shots/v5926-g4-chiaro.png' });
  const st = await vista.evaluate(() => {
    const host = document.querySelector('.sn-confirm-host');
    return { font: getComputedStyle(document.documentElement).getPropertyValue('--sn-font'), bg: getComputedStyle(document.body).backgroundColor, host: !!host };
  });
  console.log('STILE', JSON.stringify(st));
  await vista.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'));
  await expect.poll(() => nelMondoDiFilo(app, host, 'globalThis.__l')).toBe(false);

  const t1 = Date.now();
  await chiedi(app, host, 'Seconda domanda');
  vista = await confermaSopraPagina(app);
  console.log('SECONDA DOMANDA ms', Date.now() - t1);
  await vista.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'));

  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark', themeTokens: { accent: '#2266ff' } }); });
  await chiedi(app, host, 'Filo vuole impostare: Tema → Chiaro.');
  vista = await confermaSopraPagina(app);
  await new Promise((r) => setTimeout(r, 700));
  console.log('TEMA', await vista.evaluate(() => document.documentElement.dataset.snTheme));
  await vista.screenshot({ path: 'tests/.shots/v5926-g4-scuro.png' });
  await vista.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'));
});

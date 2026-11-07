// #2095 giro 1, rilievo 1: la conferma di Filo sopra un sito (una sua finestra, non il documento del sito) mostra
// ancora il rettangolo nativo sul tasto che aspetta lo scorrimento («Scorri fino in fondo per confermare»).
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(60_000);

test('r1 la conferma sopra un sito ha il fumetto di Filo sul tasto in attesa', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.submit = async () => ({ id: 'test-fb' });
  });
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px"><h1>Pagina</h1></body></html>');
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const lungo = Array.from({ length: 120 }, (_, i) => `Riga ${i + 1} del testo che parte agli sviluppatori.`).join('\n');
  await nelMondoDiFilo(app, host, `
    window.__filoSidebarTest.runFiloAction(${JSON.stringify({ type: 'INVIA_FEEDBACK', testo: lungo, titolo: 'Prova' })});
    true;`);
  const sopra = await confermaSopraPagina(app);
  const ok = sopra.locator('.sn-confirm-row button[aria-disabled="true"]').first();
  await expect(ok, 'il tasto aspetta lo scorrimento').toHaveAttribute('title', 'Scorri fino in fondo per confermare', { timeout: 5000 });
  await ok.hover({ force: true });
  // Il fumetto di Filo dice perché il tasto non risponde, e il rettangolo nativo non ha niente da mostrare.
  await expect(sopra.locator('[data-sn-fumetto] .tip')).toHaveText('Scorri fino in fondo per confermare', { timeout: 3000 });
  expect(await ok.evaluate((el) => el.hasAttribute('title'))).toBe(false);
});

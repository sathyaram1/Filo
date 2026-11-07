// #2095 giro 1, rilievo 1: sul tasto di una conferma di Filo che aspetta lo scorrimento («Scorri fino in fondo per
// confermare») esce ancora il rettangolo nativo, sia in una pagina di Filo sia nella conferma sopra un sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { confermaSopraPagina, nelMondoDiFilo } from '../../helpers/confirm.mjs';

test.setTimeout(60_000);

const LUNGO = Array.from({ length: 120 }, (_, i) => `Riga ${i + 1} del testo da leggere prima di confermare.`).join('\n');
const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');

async function provaTastoInAttesa(page) {
  await expect.poll(() => page.evaluate(() => window.SN_CONFIRM_UI?._test.state()?.okDisabled)).toBe(true);
  const p = await page.evaluate(() => window.SN_CONFIRM_UI._test.point('ok'));
  await page.mouse.move(p.x - 3, p.y);
  await page.mouse.move(p.x, p.y);
  // Il fumetto di Filo dice perché il tasto non risponde, al posto del rettangolo nativo.
  await expect(fumetto(page)).toHaveText('Scorri fino in fondo per confermare', { timeout: 3000 });
}

test('r1 pagina di Filo: il tasto della conferma in attesa ha il fumetto di Filo', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.SN_SUGGERIMENTO && !!window.SN_CONFIRM_UI);
  await page.evaluate((t) => { window.SN_CONFIRM_UI.confirm({ title: 'Prova', text: t, okLabel: 'Esegui' }); }, LUNGO);
  await provaTastoInAttesa(page);
});

test('r1 conferma sopra un sito: il tasto in attesa ha il fumetto di Filo', async ({ app, openTab, testServer }) => {
  await app.evaluate(() => { globalThis.SN_FEEDBACK.submit = async () => ({ id: 'test-fb' }); });
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px"><h1>Pagina</h1></body></html>');
  const host = new URL(page.url()).hostname;
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelMondoDiFilo(app, host, `
    window.__filoSidebarTest.runFiloAction(${JSON.stringify({ type: 'INVIA_FEEDBACK', testo: LUNGO, titolo: 'Prova' })});
    true;`);
  const sopra = await confermaSopraPagina(app);
  await provaTastoInAttesa(sopra);
});

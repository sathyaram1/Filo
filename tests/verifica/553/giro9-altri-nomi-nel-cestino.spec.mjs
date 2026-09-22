// #553 giro 9 — resta un nome nell'elenco del cestino con dentro il dato
// chiesto: «subscribe».
//
// È la quinta volta che rientra la stessa famiglia (secondo, sesto, settimo e
// ottavo giro): Filo decide cosa buttare dal NOME del riquadro. L'ottavo giro
// ha spostato in coda «menu» e «subscription»; il gemello «subscribe», che su
// una pagina di prezzi è il riquadro dei piani, è rimasto nel cestino.

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html, url = 'https://esempio.it/prezzi') => app.evaluate(async (_e, [p, u]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(p, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return (await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u })).output;
}, [html, url]);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

const PIANI = (nome) => '<!DOCTYPE html><html><head><title>Piani</title></head><body>'
  + '<h1>Piani e prezzi</h1>'
  + `<section ${nome}><h2>Scegli il piano</h2><p>Mensile 9,99 euro</p>`
  + '<p>Annuale 99,00 euro</p></section></body></html>';

test('i prezzi in un riquadro chiamato «subscribe» arrivano a Filo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, PIANI('id="subscribe"'));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('9,99');
  expect(String(out.text)).toContain('99,00');
});

test('e anche quando quel nome è scritto come classe', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, PIANI('class="subscribe"'));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('9,99');
});

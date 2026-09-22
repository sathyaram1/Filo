// #553 giro 8 — resta una lista di NOMI che mandano il riquadro nel cestino
// invece che in coda, e ci finisce dentro il contenuto che l'utente chiede.
//
// Il secondo, il sesto e il settimo giro hanno trovato la stessa causa: Filo
// decide cosa buttare dal NOME del riquadro. La cura ha spostato in coda il
// contorno (piè di pagina, intestazione, banner, promo), ma un'altra lista di
// nomi continua a mandare il riquadro nel cestino con tutto il suo contenuto.
// Su un sito di ristorante il listino sta in un riquadro chiamato «menu», e
// «quanto costa» è una delle domande per cui questa lettura esiste.

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html, url = 'https://esempio.it/pagina') => app.evaluate(async (_e, [pagina, indirizzo]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(pagina, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: indirizzo });
  return r.output;
}, [html, url]);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

const PIZZERIA = (nome) => '<!DOCTYPE html><html><head><title>Pizzeria Da Gino</title></head><body>'
  + '<nav class="navbar"><a href="#menu">Menu</a><a href="#contatti">Contatti</a></nav>'
  + '<section id="home"><h1>Pizzeria Da Gino</h1><p>Dal 1974 a Bologna.</p></section>'
  + `<section ${nome}><h2>Il nostro menu</h2><ul><li>Margherita 6,50 euro</li>`
  + '<li>Diavola 8,00 euro</li><li>Caffe 1,20 euro</li></ul></section>'
  + '<footer class="site-footer"><p>Orari: lun-sab 12:00-23:00</p></footer></body></html>';

test('il listino di una pizzeria non sparisce perché il riquadro si chiama «menu»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, PIZZERIA('id="menu"'));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Margherita 6,50');
  expect(String(out.text)).toContain('Caffe 1,20');
});

test('nemmeno quando quel nome è scritto come classe', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, PIZZERIA('class="menu"'));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Margherita 6,50');
});

test('i piani di un listino chiamati «subscription» arrivano lo stesso', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Piani</title></head><body>'
    + '<h1>Piani</h1><div class="subscription"><p>Mensile 9,99 euro</p>'
    + '<p>Annuale 99,00 euro</p></div></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('9,99');
  expect(String(out.text)).toContain('99,00');
});

test('il selettore mensile/annuale di un listino non sparisce col suo ruolo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Piani</title></head><body>'
    + '<h1>Piani</h1><div role="tablist"><button>Mensile 9,99 euro</button>'
    + '<button>Annuale 99,00 euro</button></div><p>Scegli il piano.</p></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('9,99');
});

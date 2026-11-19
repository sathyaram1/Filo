import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import * as d from '../../agent/driver.mjs';
import { apriFiloPerLaProva } from '../../agent/provaPreparazione.mjs';
import { eseguiMossa } from '../../agent/provaMosse.mjs';

test.setTimeout(120_000);

let server;
let base;
test.beforeAll(async () => {
  server = createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (q.url.startsWith('/b')) return r.end('<!doctype html><title>Bersaglio</title><h1>Bersaglio</h1><input id="c" autofocus aria-label="Campo B">');
    r.end('<!doctype html><title>Modulo</title><h1>Modulo</h1><a href="/b" target="_blank">Apri accanto</a><input id="c" autofocus aria-label="Nome">');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server && server.close());

const fuocoVero = (app) => app.evaluate(({ webContents }) => { const w = webContents.getFocusedWebContents(); return w ? w.getURL() : null; });

async function segno(app, shell, re, page) {
  let trovato;
  await expect.poll(async () => {
    const { map } = await d.markInteractables(app, shell);
    await d.clearMarks(app, shell);
    trovato = { map, voce: map.find((x) => re.test(x.label) && (!page || x.page === page)) };
    return !!trovato.voce;
  }, { timeout: 10_000 }).toBe(true);
  return trovato;
}

test('esplora: clic su una scheda della barra, poi scrivi', async () => {
  const { app, shell } = await apriFiloPerLaProva();
  try {
    await d.navigate(app, shell, `${base}/modulo`);
    await d.openTab(app, shell, `${base}/b`);
    await d.sleep(1500);
    const { map, voce } = await segno(app, shell, /^Modulo$/, 'shell');
    const fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    await d.sleep(800);
    console.log('FUOCO VERO dopo clic scheda', await fuocoVero(app), 'fuoco driver', fuoco.url());
    await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
    const v = await d.activeView(app, shell);
    console.log('URL attiva', v.url(), 'valore', await v.evaluate(() => [document.activeElement && document.activeElement.id, document.getElementById('c').value]));
  } finally { await d.closeFilo(app); }
});

test('esplora: clic su un collegamento che apre una scheda accanto, poi scrivi', async () => {
  const { app, shell } = await apriFiloPerLaProva();
  try {
    await d.navigate(app, shell, `${base}/modulo`);
    await d.sleep(1000);
    const { map, voce } = await segno(app, shell, /^Apri accanto$/);
    const fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    await d.sleep(2000);
    console.log('FUOCO VERO dopo collegamento', await fuocoVero(app), 'fuoco driver', fuoco.url());
    await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
    const v = await d.activeView(app, shell);
    console.log('URL attiva', v.url(), 'valore', await v.evaluate(() => [document.activeElement && document.activeElement.id, document.getElementById('c') && document.getElementById('c').value]));
  } finally { await d.closeFilo(app); }
});

// #2507.1 giro 1, rilievo 1: una home nuova aperta dalla barra delle schede si prende la tastiera (#1128), e chi la
// apre a mano ci scrive subito. Chi pilota, dopo un clic o un tasto nella barra, scriveva nella barra.

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
    r.end('<!doctype html><title>Modulo</title><h1>Modulo</h1><input aria-label="Nome" placeholder="Nome">');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server && server.close());

const indirizzi = (app) => app.evaluate(({ BrowserWindow }) =>
  BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.view.webContents.getURL()));

async function sulModulo() {
  const aperta = await apriFiloPerLaProva();
  await d.navigate(aperta.app, aperta.shell, `${base}/modulo`);
  await expect.poll(async () => (await indirizzi(aperta.app)).some((u) => u.includes('/modulo'))).toBe(true);
  return aperta;
}

async function segno(app, shell, re) {
  let trovato;
  await expect.poll(async () => {
    const { map } = await d.markInteractables(app, shell);
    await d.clearMarks(app, shell);
    trovato = { map, voce: map.find((x) => re.test(x.label) && x.page === 'shell') };
    return !!trovato.voce;
  }, { timeout: 10_000 }).toBe(true);
  return trovato;
}

// La home attiva, carica, col campo della chat: è lì che va quello che si scrive subito dopo averla aperta.
async function scritto(app, shell) {
  let valore = null;
  await expect.poll(async () => {
    const v = await d.activeView(app, shell);
    if (!v || !v.url().startsWith('filo://newtab')) return false;
    valore = await v.evaluate(() => document.getElementById('input')?.value ?? null).catch(() => null);
    return valore !== null;
  }, { timeout: 15_000 }).toBe(true);
  return valore;
}

for (const [nome, apri] of [
  ['col clic sul più della barra', async (app, shell, fuoco) => {
    const { map, voce } = await segno(app, shell, /^Nuova scheda/);
    return { map, fuoco: await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, fuoco) };
  }],
  ['con Ctrl+T premuto dopo un clic sulla barra', async (app, shell) => {
    const { map, voce } = await segno(app, shell, /^Modulo$/);
    const fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    return { map, fuoco: await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+T' }, map, fuoco) };
  }],
  ['con Ctrl+L premuto dopo un clic sulla barra', async (app, shell) => {
    const { map, voce } = await segno(app, shell, /^Modulo$/);
    const fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    return { map, fuoco: await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+L' }, map, fuoco) };
  }],
]) {
  test(`r1 la home aperta ${nome} riceve il testo scritto subito dopo`, async () => {
    const { app, shell } = await sulModulo();
    try {
      const { map, fuoco } = await apri(app, shell, null);
      await expect.poll(async () => (await indirizzi(app)).filter((u) => u.startsWith('filo://newtab')).length, { timeout: 15_000 }).toBeGreaterThan(0);
      await d.sleep(1500);
      await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
      expect(await scritto(app, shell)).toBe('ciao');
    } finally {
      await d.closeFilo(app);
    }
  });
}

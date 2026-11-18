// #2507.1 giro 1: esplorazione. Dove va la tastiera di chi pilota dopo un clic sulla barra delle schede o un tasto
// che Filo si prende, confrontato con dove la manda Filo (la vista che ha il fuoco per una persona).

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import * as d from '../../agent/driver.mjs';
import { apriFiloPerLaProva } from '../../agent/provaPreparazione.mjs';
import { eseguiMossa } from '../../agent/provaMosse.mjs';

test.describe.configure({ mode: 'serial' });
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

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => t.view.webContents.getURL());
});
const aFuoco = (app) => app.evaluate(({ webContents, BrowserWindow }) => {
  const f = webContents.getFocusedWebContents();
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  return f ? (f === win.webContents ? 'shell' : f.getURL()) : null;
});
const valoreHome = async (app, shell) => {
  const v = await d.activeView(app, shell);
  return v.evaluate(() => document.getElementById('input')?.value ?? null);
};

async function sulModulo() {
  const { app, shell } = await apriFiloPerLaProva();
  await d.navigate(app, shell, `${base}/modulo`);
  await expect.poll(async () => (await schede(app)).some((u) => u.includes('/modulo'))).toBe(true);
  return { app, shell };
}

async function segno(app, shell, re, superficie) {
  let m;
  await expect.poll(async () => {
    const { map } = await d.markInteractables(app, shell);
    await d.clearMarks(app, shell);
    m = { map, voce: map.find((x) => re.test(x.label) && (!superficie || x.page === superficie)) };
    return !!m.voce;
  }, { timeout: 10_000 }).toBe(true);
  return m;
}

test('esplora: clic su Nuova scheda nella barra, poi scrivi senza segno', async () => {
  const { app, shell } = await sulModulo();
  try {
    const { map, voce } = await segno(app, shell, /^Nuova scheda/, 'shell');
    let fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    await d.sleep(1500);
    console.log('S1 fuoco Filo dopo clic Nuova scheda:', await aFuoco(app), '| fuoco driver:', fuoco && fuoco.url());
    fuoco = await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
    console.log('S1 home input:', JSON.stringify(await valoreHome(app, shell)));
  } finally { await d.closeFilo(app); }
});

test('esplora: clic sulla scheda Modulo nella barra, poi Ctrl+W', async () => {
  const { app, shell } = await sulModulo();
  try {
    const { map, voce } = await segno(app, shell, /^Modulo$/, 'shell');
    let fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    console.log('S3 fuoco Filo:', await aFuoco(app), '| driver:', fuoco && fuoco.url());
    fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+W' }, map, fuoco);
    await d.sleep(1000);
    console.log('S3 schede dopo Ctrl+W:', JSON.stringify(await schede(app)));
  } finally { await d.closeFilo(app); }
});

test('esplora: clic sulla scheda nella barra, Ctrl+T, poi scrivi senza segno', async () => {
  const { app, shell } = await sulModulo();
  try {
    const { map, voce } = await segno(app, shell, /^Modulo$/, 'shell');
    let fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+T' }, map, fuoco);
    await d.sleep(1500);
    console.log('S2 schede:', JSON.stringify(await schede(app)), '| fuoco Filo:', await aFuoco(app), '| driver:', fuoco && fuoco.url());
    await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
    console.log('S2 home input:', JSON.stringify(await valoreHome(app, shell)));
  } finally { await d.closeFilo(app); }
});

test('esplora: clic nel campo della pagina, Ctrl+T, poi scrivi senza segno', async () => {
  const { app, shell } = await sulModulo();
  try {
    const { map, voce } = await segno(app, shell, /^Nome$/, 'view');
    let fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+T' }, map, fuoco);
    await d.sleep(1500);
    console.log('S4 fuoco Filo:', await aFuoco(app), '| driver:', fuoco && fuoco.url());
    await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
    console.log('S4 home input:', JSON.stringify(await valoreHome(app, shell)));
  } finally { await d.closeFilo(app); }
});

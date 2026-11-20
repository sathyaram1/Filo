// La tastiera di chi pilota la prova da utente (tests/agent/prova.mjs, #2507.1) va dove Filo ha messo il fuoco, come per
// una persona: una home nuova (#1128), una scheda aperta da un collegamento. Andava all'ultima superficie cliccata, e il
// testo finiva nella barra o in una pagina nascosta.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import * as d from './agent/driver.mjs';
import { apriFiloPerLaProva } from './agent/provaPreparazione.mjs';
import { eseguiMossa } from './agent/provaMosse.mjs';

test.setTimeout(120_000);

let server;
let base;
test.beforeAll(async () => {
  server = createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (q.url.startsWith('/accanto')) return r.end('<!doctype html><title>Accanto</title><input id="c" autofocus aria-label="Campo accanto">');
    r.end('<!doctype html><title>Modulo</title><h1>Modulo</h1><a href="/accanto" target="_blank">Apri accanto</a><input id="c" aria-label="Nome">');
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

async function segno(app, shell, trova) {
  let trovato;
  await expect.poll(async () => {
    const { map } = await d.markInteractables(app, shell);
    await d.clearMarks(app, shell);
    trovato = { map, voce: map.find(trova) };
    return !!trovato.voce;
  }, { timeout: 10_000 }).toBe(true);
  return trovato;
}
const nellaBarra = (re) => (x) => re.test(x.label) && x.page === 'shell';

// Il valore del campo `campo` della scheda attiva, quando la scheda attiva risponde a `indirizzo`.
async function scritto(app, shell, indirizzo, campo) {
  let valore = null;
  await expect.poll(async () => {
    const v = await d.activeView(app, shell);
    if (!v || !indirizzo.test(v.url())) return false;
    valore = await v.evaluate((id) => document.getElementById(id)?.value ?? null, campo).catch(() => null);
    return valore !== null;
  }, { timeout: 15_000 }).toBe(true);
  return valore;
}

const HOME = /^filo:\/\/newtab/;

for (const [nome, apri] of [
  ['col clic sul più della barra', async (app, shell) => {
    const { map, voce } = await segno(app, shell, nellaBarra(/^Nuova scheda/));
    return { map, fuoco: await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null) };
  }],
  ['con Ctrl+T premuto dopo un clic sulla barra', async (app, shell) => {
    const { map, voce } = await segno(app, shell, nellaBarra(/^Modulo$/));
    const fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    return { map, fuoco: await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+T' }, map, fuoco) };
  }],
  ['con Ctrl+L premuto dopo un clic sulla barra', async (app, shell) => {
    const { map, voce } = await segno(app, shell, nellaBarra(/^Modulo$/));
    const fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    return { map, fuoco: await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+L' }, map, fuoco) };
  }],
  // Un tasto che Filo si prende dopo un clic nella pagina: la tastiera non resta alla pagina lasciata.
  ['con Ctrl+T premuto dopo un clic in un campo della pagina', async (app, shell) => {
    const { map, voce } = await segno(app, shell, (x) => x.label === 'Nome' && x.page === 'view');
    const fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    return { map, fuoco: await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+T' }, map, fuoco) };
  }],
]) {
  test(`la home aperta ${nome} riceve il testo scritto subito dopo`, async () => {
    const { app, shell } = await sulModulo();
    try {
      const { map, fuoco } = await apri(app, shell);
      await expect.poll(async () => (await indirizzi(app)).filter((u) => HOME.test(u)).length, { timeout: 15_000 }).toBeGreaterThan(0);
      await d.sleep(1500);
      await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
      expect(await scritto(app, shell, HOME, 'input')).toBe('ciao');
    } finally {
      await d.closeFilo(app);
    }
  });
}

test('la scheda aperta da un collegamento riceve il testo scritto subito dopo', async () => {
  const { app, shell } = await sulModulo();
  try {
    const { map, voce } = await segno(app, shell, (x) => x.label === 'Apri accanto');
    const fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    await expect.poll(async () => (await d.activeView(app, shell))?.url() || '', { timeout: 15_000 }).toContain('/accanto');
    await d.sleep(1500);
    await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
    expect(await scritto(app, shell, /\/accanto/, 'c')).toBe('ciao');
  } finally {
    await d.closeFilo(app);
  }
});

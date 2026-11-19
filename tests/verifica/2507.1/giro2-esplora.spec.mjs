// #2507.1 giro 2: esplorazione. Chiamate vere durante la preparazione, tastiera dopo un tasto di Filo, Alt+cifra, Esc sul menu.

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import * as d from '../../agent/driver.mjs';
import { apriFiloPerLaProva, preparaFilo } from '../../agent/provaPreparazione.mjs';
import { eseguiMossa } from '../../agent/provaMosse.mjs';
import { home, chiedi } from '../../helpers/chatFinta.mjs';

test.setTimeout(150_000);

let server;
let base;
test.beforeAll(async () => {
  server = createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end('<!doctype html><title>Modulo</title><h1>Modulo</h1><a href="/altro">Un collegamento</a><input id="c" aria-label="Nome">');
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

for (let giro = 1; giro <= 3; giro++) {
  test(`preparazione e chat della home: nessuna chiamata con la chiave al fornitore (${giro})`, async () => {
    const { app, shell } = await apriFiloPerLaProva();
    try {
      await app.evaluate(() => {
        globalThis.__rete = [];
        const vera = globalThis.fetch;
        globalThis.fetch = (url, init) => {
          const h = init && init.headers;
          const auth = h ? (typeof h.get === 'function' ? h.get('authorization') : (h.Authorization || h.authorization)) : '';
          globalThis.__rete.push(`${String(url && url.url || url).slice(0, 120)} ${auth ? 'CON CHIAVE' : ''}`);
          return vera(url, init);
        };
        const P = globalThis.SN_PROVIDERS;
        const risposta = (attempts, text) => ({ model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' });
        P.streamCompleteWithFallback = async ({ attempts, onDelta }) => { onDelta && onDelta('Eccomi, sono Filo.'); return risposta(attempts, 'Eccomi, sono Filo.'); };
        P.completeWithFallback = async ({ attempts }) => risposta(attempts, '{}');
      });
      const t0 = Date.now();
      await preparaFilo(app, shell, 'k-test');
      const page = await home(app);
      console.log('home trovata dopo', Date.now() - t0, 'ms');
      await chiedi(page, 'ciao Filo');
      await expect(page.getByText('Eccomi, sono Filo.').first()).toBeVisible({ timeout: 15_000 });
      await d.sleep(3000);
      const rete = await app.evaluate(() => globalThis.__rete);
      console.log(rete.join('\n'));
      expect(rete.filter((r) => /openrouter/.test(r) && /CON CHIAVE/.test(r))).toEqual([]);
    } finally {
      await d.closeFilo(app);
    }
  });
}

test('clic nel campo, Ctrl+T, Ctrl+W: il testo scritto dopo torna nel campo della pagina', async () => {
  const { app, shell } = await sulModulo();
  try {
    const { map, voce } = await segno(app, shell, (x) => x.label === 'Nome' && x.page === 'view');
    let fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+T' }, map, fuoco);
    await expect.poll(async () => (await indirizzi(app)).length, { timeout: 15_000 }).toBe(2);
    await d.sleep(1500);
    fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+W' }, map, fuoco);
    await expect.poll(async () => (await indirizzi(app)).length, { timeout: 15_000 }).toBe(1);
    await d.sleep(1000);
    await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao' }, map, fuoco);
    const v = await d.activeView(app, shell);
    expect(await v.evaluate(() => document.getElementById('c').value)).toBe('ciao');
  } finally {
    await d.closeFilo(app);
  }
});

test('Alt+1 con due schede torna alla prima', async () => {
  const { app, shell } = await sulModulo();
  try {
    let fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Ctrl+T' }, [], null);
    await expect.poll(async () => (await d.activeView(app, shell))?.url() || '', { timeout: 15_000 }).toMatch(/^filo:\/\/newtab/);
    await d.sleep(1000);
    fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Alt+1' }, [], fuoco);
    await expect.poll(async () => (await d.activeView(app, shell))?.url() || '', { timeout: 10_000 }).toContain('/modulo');
  } finally {
    await d.closeFilo(app);
  }
});

test('Esc chiude il menu del tasto destro', async () => {
  const { app, shell } = await sulModulo();
  try {
    const { map, voce } = await segno(app, shell, (x) => x.label === 'Un collegamento');
    const fuoco = await eseguiMossa(app, shell, { azione: 'destro', segno: voce.i }, map, null);
    await segno(app, shell, (x) => /Copia URL/.test(x.label));
    await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Esc' }, map, fuoco);
    await expect.poll(async () => {
      const { map: m } = await d.markInteractables(app, shell);
      await d.clearMarks(app, shell);
      return m.some((x) => /Copia URL/.test(x.label));
    }, { timeout: 5_000 }).toBe(false);
  } finally {
    await d.closeFilo(app);
  }
});

test('clic sul più, scrivi, Invio: la richiesta parte dalla home nuova', async () => {
  const { app, shell } = await sulModulo();
  try {
    await app.evaluate(() => {
      globalThis.__chat = [];
      const P = globalThis.SN_PROVIDERS;
      const risposta = (attempts, text) => ({ model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' });
      P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => { globalThis.__chat.push(JSON.stringify(messages)); onDelta && onDelta('Eccomi.'); return risposta(attempts, 'Eccomi.'); };
      P.completeWithFallback = async ({ attempts }) => risposta(attempts, '{}');
    });
    await preparaFilo(app, shell, 'k-test').catch(() => {});
    const { map, voce } = await segno(app, shell, (x) => /^Nuova scheda/.test(x.label) && x.page === 'shell');
    let fuoco = await eseguiMossa(app, shell, { azione: 'clic', segno: voce.i }, map, null);
    await d.sleep(2000);
    fuoco = await eseguiMossa(app, shell, { azione: 'scrivi', testo: 'ciao Filo' }, map, fuoco);
    fuoco = await eseguiMossa(app, shell, { azione: 'tasto', tasto: 'Invio' }, map, fuoco);
    await expect.poll(async () => (await app.evaluate(() => globalThis.__chat)).some((c) => c.includes('ciao Filo')), { timeout: 15_000 }).toBe(true);
  } finally {
    await d.closeFilo(app);
  }
});

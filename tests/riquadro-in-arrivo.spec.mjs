// #1560 — Un riquadro incorporato della stessa origine che sta ancora caricando il suo indirizzo, se Filo lo tocca da
// fuori (contentWindow, contentDocument, uno script nel suo mondo isolato), perde il preload: dentro Filo non c'è più,
// e Alt+E o il tasto destro lì non fanno niente. Qui il riquadro arriva in ritardo apposta, e si guarda che dopo il
// suo caricamento la spiegazione si apra DENTRO di lui. Regole: patterns/riquadri-incorporati-iframe-filo-gira-anche-li.md.

import http from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { conta } from './helpers/riquadri.mjs';

const RITARDO_MS = 1500;

const RIQUADRO = `<!doctype html><meta charset="utf-8">
<style>body { margin: 0; padding: 10px; font: 16px/1.5 system-ui, sans-serif; }</style>
<p id="bersaglio">supercalifragilistico</p>`;

const PAGINA = (conRiquadro) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  h1 { margin: 24px; font-size: 20px; }
  p { margin: 24px; }
  iframe { display: block; width: 560px; height: 300px; border: 1px solid #ccc; margin: 0 24px; }
</style>
<h1>Pagina con un riquadro che arriva tardi</h1>
<p>Testo della pagina, fuori dal riquadro, su cui passa il puntatore mentre il riquadro carica.</p>
${conRiquadro ? '<iframe id="riquadro" src="/riquadro"></iframe>' : ''}`;

// Il riquadro risponde dopo RITARDO_MS: quando la pagina è pronta lui è ancora in arrivo, com'è sui siti veri.
async function server() {
  const srv = http.createServer((req, res) => {
    const invia = (body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
    if (req.url.startsWith('/riquadro')) { setTimeout(() => invia(RIQUADRO), RITARDO_MS); return; }
    if (req.url.startsWith('/con')) { invia(PAGINA(true)); return; }
    invia(PAGINA(false));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { origine: `http://127.0.0.1:${srv.address().port}`, chiudi: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origArrivo = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origArrivo,
      streamComplete: async ({ onDelta }) => { onDelta('Una parola lunga e allegra.'); return { text: 'Una parola lunga e allegra.', usage: {} }; },
    };
  });
}

async function ripristinaProvider(app) {
  await app.evaluate(() => { if (globalThis.__origArrivo) globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origArrivo; });
}

async function aspettaFiloPronto(page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
}

// Il puntatore che va e viene sulla pagina e sul riquadro finché il riquadro non è arrivato, come una mano vera.
async function passaSopraMentreArriva(page, riquadroCaricato) {
  const box = await page.locator('#riquadro').boundingBox();
  const fine = Date.now() + RITARDO_MS + 1000;
  let i = 0;
  while (Date.now() < fine && !(await riquadroCaricato())) {
    const suRiquadro = i % 2 === 1;
    const x = suRiquadro ? box.x + 40 + (i % 5) * 60 : 60 + (i % 7) * 50;
    const y = suRiquadro ? box.y + 40 + (i % 3) * 50 : 70 + (i % 3) * 20;
    await page.mouse.move(x, y, { steps: 4 });
    i++;
  }
  return i;
}

// SUCCESSO dal punto di vista di chi usa il riquadro: seleziona una parola lì dentro, Alt+E, e la spiegazione si apre
// dentro il riquadro. Se il riquadro ha perso il preload, Filo lì dentro non c'è e la spiegazione non arriva mai.
async function spiegazioneDentroIlRiquadro(app, page, src) {
  let frame = null;
  await expect.poll(() => {
    frame = page.frames().find((f) => f.url() === src) || null;
    return !!frame;
  }, { timeout: 8000, message: 'il riquadro non è arrivato' }).toBe(true);
  await frame.locator('#bersaglio').dblclick();
  await expect.poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 })
    .toContain('supercalifragilistico');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  const riquadriAperti = async () => {
    try { return await conta(app, page, '.sn-popup', frame); } catch (e) {
      if (/nessun mondo di Filo/.test(String(e && e.message))) return -1;
      throw e;
    }
  };
  await expect.poll(riquadriAperti, {
    timeout: 10_000,
    message: 'Alt+E dentro il riquadro non ha aperto la spiegazione (-1: dentro il riquadro Filo non c\'è)',
  }).toBeGreaterThan(0);
}

test('riquadro della stessa origine ancora in arrivo quando la pagina è pronta: dentro c\'è Filo e Alt+E spiega', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const s = await server();
  try {
    await preparaProvider(app);
    const page = await openTab(`${s.origine}/con`);
    await aspettaFiloPronto(page);
    // Lo scenario è quello vero: Filo della pagina è pronto, il riquadro no.
    const caricato = () => page.evaluate(() => {
      const f = document.getElementById('riquadro');
      return !!f && performance.getEntriesByName(f.src).length > 0;
    });
    expect(await caricato(), 'il riquadro era già arrivato: lo scenario non è quello vero').toBe(false);
    await spiegazioneDentroIlRiquadro(app, page, `${s.origine}/riquadro`);
    await ripristinaProvider(app);
  } finally { await s.chiudi(); }
});

test('riquadro aggiunto dopo, col puntatore che ci passa sopra mentre arriva: dentro c\'è Filo e Alt+E spiega', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const s = await server();
  try {
    await preparaProvider(app);
    const page = await openTab(`${s.origine}/senza`);
    await aspettaFiloPronto(page);
    await page.evaluate(() => {
      const f = document.createElement('iframe');
      f.id = 'riquadro';
      f.src = '/riquadro';
      document.body.appendChild(f);
    });
    const caricato = () => page.evaluate(() => performance.getEntriesByName(document.getElementById('riquadro').src).length > 0);
    const passaggi = await passaSopraMentreArriva(page, caricato);
    expect(passaggi, 'il puntatore non è passato sopra mentre il riquadro arrivava').toBeGreaterThan(3);
    await spiegazioneDentroIlRiquadro(app, page, `${s.origine}/riquadro`);
    await ripristinaProvider(app);
  } finally { await s.chiudi(); }
});

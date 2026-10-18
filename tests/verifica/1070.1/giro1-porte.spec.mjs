// #1070.1 giro 1 — porte vicine al clic semplice: tastiera e dito; le strade vere
// (Ctrl+A, selezione trascinata nel campo, tasto destro sulla selezione della pagina) restano.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="pp">Il ciclo dell'acqua porta il vapore <button id="bp" style="font:20px sans-serif">Evidenzia</button> in alto e lo restituisce come pioggia sulle montagne.</p>
<p id="pl">La deriva dei continenti <a id="al" href="#fondo">sposta</a> le placche di pochi centimetri ogni anno.</p>
<input id="ic" style="display:block;font:20px monospace;width:640px">
<p id="pv">Le maree dipendono dalla Luna e dal Sole, che tirano gli oceani in direzioni diverse.</p>
</body>`;

async function fornitoreFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__conti = { spiega: 0, altro: 0 };
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const spiega = t.includes('ha selezionato un testo');
      globalThis.__conti[spiega ? 'spiega' : 'altro'] += 1;
      return { text: spiega ? 'Spiegazione di prova' : 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}
const conti = (app) => app.evaluate(() => ({ ...globalThis.__conti }));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function apri(app, openTab, testServer) {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => {
    let n = 0;
    const scegli = (da, a, dove, fino) => {
      const r = document.createRange();
      r.setStart(da, dove); r.setEnd(a, fino);
      getSelection().removeAllRanges(); getSelection().addRange(r);
    };
    document.getElementById('bp').addEventListener('click', () => {
      const t = document.getElementById('pp').lastChild;
      n += 1;
      scegli(t, t, n % 6, 25 + (n % 6));
    });
    document.getElementById('al').addEventListener('click', (e) => {
      e.preventDefault();
      const p = document.getElementById('pl');
      n += 1;
      scegli(p.firstChild, p.lastChild, n % 6, p.lastChild.textContent.length - (n % 3));
    });
    const ic = document.getElementById('ic');
    ic.addEventListener('click', () => {
      n += 1;
      ic.value = `https://esempio.it/condividi/${n}/ricetta-della-nonna`;
      ic.select();
    });
    window.__sel = () => {
      const a = document.activeElement;
      return a && a.tagName === 'INPUT' ? a.value.slice(a.selectionStart, a.selectionEnd) : getSelection().toString();
    };
  });
  return page;
}

async function centro(page, sel) {
  const b = await page.locator(sel).boundingBox();
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

test('tastiera: Invio sul pulsante e sul collegamento non paga la selezione della pagina; Ctrl+A sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  const viste = new Set();
  for (const sel of ['#bp', '#al']) {
    await page.locator(sel).focus();
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await pausa(700); viste.add(await page.evaluate(() => window.__sel())); }
  }
  expect(viste.size).toBeGreaterThan(4);
  await pausa(800);
  expect((await conti(app)).spiega).toBe(0);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.locator('#pv').click();
  await pausa(600);
  await page.keyboard.press('Control+a');
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(1);
});

// Sul campo già selezionato il tocco apre il menu di Filo come il tasto destro (tocco su una selezione): quella
// spiegazione è chiesta, non anticipata, e qui non si conta.
test('dito: cinque tocchi sul pulsante e sul collegamento non pagano spiegazioni', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  const cdp = await page.context().newCDPSession(page);
  const tocca = async ({ x, y }) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await pausa(90);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const viste = new Set();
  for (const sel of ['#bp', '#al']) {
    const p = await centro(page, sel);
    for (let i = 0; i < 5; i++) { await tocca(p); await pausa(700); viste.add(await page.evaluate(() => window.__sel())); }
  }
  expect(viste.size).toBe(10);
  await pausa(800);
  expect((await conti(app)).spiega).toBe(0);
});

test('strade vere: trascinare dentro il campo; tasto destro sulla selezione fatta dalla pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.locator('#bp').click();
  await pausa(800);
  expect((await conti(app)).spiega).toBe(0);
  const testo = await page.evaluate(() => getSelection().toString());
  expect(testo.length).toBeGreaterThan(5);
  // tasto destro sulla selezione: la spiegazione si chiede davvero
  const r = await page.evaluate(() => { const q = getSelection().getRangeAt(0).getClientRects()[0]; return { x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2) }; });
  await page.mouse.click(r.x, r.y, { button: 'right' });
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 8000 }).toBe(1);
  await page.keyboard.press('Escape');
  await pausa(500);
  // selezione trascinata dentro il campo
  await page.locator('#ic').fill('la ricetta della nonna con le patate al forno');
  const b = await page.locator('#ic').boundingBox();
  const y = Math.round(b.y + b.height / 2);
  await page.mouse.move(Math.round(b.x + 30), y);
  await page.mouse.down();
  await page.mouse.move(Math.round(b.x + 300), y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await conti(app)).spiega, { timeout: 5000 }).toBe(2);
});

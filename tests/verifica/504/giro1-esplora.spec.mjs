// #504 giro 1 — «traducimi questa pagina» chiesto a Filo in chat: la pagina si traduce, si riprende, prende il
// testo nuovo e torna all'originale come dall'icona. Il fornitore finto antepone "IT " a ogni blocco.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const ARTICLE = `<!doctype html><html lang="en"><head><title>Football era</title></head><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
  <p id="p2">Second paragraph of the body text, also long enough to be picked up.</p>
</body></html>`;

const LONG = `<!doctype html><html lang="en"><head><title>Long one</title></head><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A very long English article about nothing in particular</h1>
  ${Array.from({ length: 40 }, (_, i) => `<p id="p${i}">Paragraph number ${i} of the body text, deliberately long enough to take a meaningful share of the request budget so that the article needs several separate requests to be translated in full.</p>`).join('\n  ')}
</body></html>`;

const FEED = `<!doctype html><html lang="en"><head><title>Feed</title></head><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A feed that keeps growing while you scroll it</h1>
  <div id="feed">
    <div class="row" id="r0">First row of the feed, written in English.</div>
    <div class="row" id="r1">Second row of the feed, written in English.</div>
  </div>
  <script>
    window.__addRows = (n) => {
      const feed = document.getElementById('feed');
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        d.id = 'later' + i; d.className = 'row';
        d.textContent = 'Row number ' + i + ' arrived after the translation was done.';
        feed.appendChild(d);
      }
    };
  </script>
</body></html>`;

// failAfter -1: mai guasto; delay: ogni richiesta dura tanto.
async function fornitore(app, { failAfter = -1, delay = 0 } = {}) {
  await app.evaluate(async (_e, { failAfter, delay }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__t = { calls: 0, blocks: 0, failAfter, delay };
    if (!globalThis.__tOrig) globalThis.__tOrig = P.completeWithFallback;
    const orig = globalThis.__tOrig;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const s = globalThis.__t;
      s.calls++;
      if (s.delay) await new Promise((r) => setTimeout(r, s.delay));
      if (s.failAfter >= 0 && s.calls > s.failAfter) throw new Error('fetch failed');
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      s.blocks += parts.length;
      return { text: parts.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  }, { failAfter, delay });
}
const ripara = (app) => app.evaluate(() => { globalThis.__t.failAfter = -1; globalThis.__t.delay = 0; });
const blocchi = (app) => app.evaluate(() => globalThis.__t.blocks);
const tradotti = (page) => page.evaluate(() => document.querySelectorAll('[data-sn-translated="1"]').length);
const doppi = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-sn-translated="1"]'))
  .filter((el) => /^IT\s+IT\s/.test(el.textContent || '')).length);

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ id: t.id, url: t.url })));
async function tornaAllaHome(shell) {
  const h = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
}

let giro = 0;
// Una richiesta in chat che fa chiamare TRADUCI_PAGINA con `args`; torna l'esito che il modello ha ricevuto.
async function chiediTraduzione(app, shell, args, frase) {
  giro += 1;
  const id = `t${giro}`;
  await tornaAllaHome(shell);
  const page = await home(app);
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id, name: 'TRADUCI_PAGINA', arguments: JSON.stringify(args) }] },
    { text: 'Fatto.' },
  ]);
  const prima = await page.locator('.dash-activity').count();
  await chiedi(page, frase);
  await expect.poll(async () => {
    for (const msgs of await chiamateAlModello(app)) {
      const m = msgs.find((x) => x.role === 'tool' && x.tool_call_id === id);
      if (m) return String(m.content);
    }
    return '';
  }, { timeout: 20_000 }).not.toBe('');
  let esito = '';
  for (const msgs of await chiamateAlModello(app)) {
    const m = msgs.find((x) => x.role === 'tool' && x.tool_call_id === id);
    if (m) esito = String(m.content);
  }
  await expect.poll(() => page.locator('.dash-activity').count()).toBeGreaterThan(prima);
  return { esito, home: page };
}

test('chat: «traducimi questa pagina» la traduce; ripetuto non la rimette in inglese', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await fornitore(app);
  const page = await testServer.openReady(openTab, ARTICLE);
  const a = await chiediTraduzione(app, shell, {}, 'traducimi questa pagina');
  console.log('ESITO1', a.esito);
  await expect(page.locator('#title')).toHaveText(/^IT /, { timeout: 30_000 });
  await expect(page.locator('#p2')).toHaveText(/^IT /, { timeout: 30_000 });
  await a.home.screenshot({ path: 'tests/.shots/v504-home-dopo.png' });
  console.log('RIGA1', await a.home.locator('.dash-activity').last().innerText());

  const b = await chiediTraduzione(app, shell, {}, 'traducila');
  console.log('ESITO2', b.esito);
  await page.waitForTimeout(2000);
  await expect(page.locator('#title')).toHaveText(/^IT /);
  expect(await doppi(page)).toBe(0);
  console.log('RIGA2', await b.home.locator('.dash-activity').last().innerText());

  const c = await chiediTraduzione(app, shell, { originale: true }, 'torna all\'originale');
  console.log('ESITO3', c.esito);
  await expect(page.locator('#title')).toHaveText('The end of an era in European football', { timeout: 15_000 });
  const d = await chiediTraduzione(app, shell, { originale: true }, 'torna all\'originale');
  console.log('ESITO4', d.esito);
  await page.waitForTimeout(1500);
  await expect(page.locator('#title')).toHaveText('The end of an era in European football');
  console.log('RIGA4', await d.home.locator('.dash-activity').last().innerText());
  await ripristina(app);
});

test('chat: ripetuta mentre traduce non la ferma; l\'originale chiesto a metà la ferma', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  await fornitore(app, { delay: 2500 });
  const page = await testServer.openReady(openTab, LONG);
  const a = await chiediTraduzione(app, shell, {}, 'traducimi questa pagina');
  console.log('ESITO-A', a.esito);
  await expect.poll(() => tradotti(page), { timeout: 60_000 }).toBeGreaterThan(0);
  const b = await chiediTraduzione(app, shell, {}, 'traducila tutta');
  console.log('ESITO-B', b.esito);
  console.log('RIGA-B', await b.home.locator('.dash-activity').last().innerText());
  await expect.poll(() => tradotti(page), { timeout: 90_000 }).toBe(41);
  expect(await doppi(page)).toBe(0);

  await fornitore(app, { delay: 2500 });
  const c = await chiediTraduzione(app, shell, { originale: true }, 'rimettila in inglese');
  await expect.poll(() => tradotti(page), { timeout: 15_000 }).toBe(0);
  const d = await chiediTraduzione(app, shell, {}, 'traducimi questa pagina');
  await expect.poll(() => tradotti(page), { timeout: 60_000 }).toBeGreaterThan(0);
  const e = await chiediTraduzione(app, shell, { originale: true }, 'ferma, rimettila in inglese');
  console.log('ESITO-E', e.esito);
  await expect.poll(() => tradotti(page), { timeout: 15_000 }).toBe(0);
  await page.waitForTimeout(8000);
  expect(await tradotti(page)).toBe(0);
  await ripristina(app);
});

test('chat: riprende una traduzione interrotta senza ripagare i pezzi fatti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  await fornitore(app, { failAfter: 1 });
  const page = await testServer.openReady(openTab, LONG);
  const a = await chiediTraduzione(app, shell, {}, 'traducimi questa pagina');
  console.log('ESITO-I', a.esito);
  await expect.poll(() => tradotti(page), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(4000);
  const meta = await tradotti(page);
  expect(meta).toBeLessThan(41);
  await ripara(app);
  const b = await chiediTraduzione(app, shell, {}, 'riprendi la traduzione');
  console.log('ESITO-R', b.esito);
  await expect.poll(() => tradotti(page), { timeout: 90_000 }).toBe(41);
  expect(await doppi(page)).toBe(0);
  await ripristina(app);
});

test('chat: il testo arrivato dopo si traduce da solo, senza ripagare il resto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await fornitore(app);
  const page = await testServer.openReady(openTab, FEED);
  await chiediTraduzione(app, shell, {}, 'traducimi questa pagina');
  await expect(page.locator('#r1')).toHaveText(/^IT /, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const pagati = await blocchi(app);
  await page.evaluate(() => window.__addRows(4));
  const b = await chiediTraduzione(app, shell, {}, 'traduci anche il testo nuovo');
  console.log('ESITO-N', b.esito);
  for (const id of ['#later0', '#later3']) await expect(page.locator(id)).toHaveText(/^IT /, { timeout: 30_000 });
  expect(await doppi(page)).toBe(0);
  expect(await blocchi(app) - pagati).toBe(4);
  await ripristina(app);
});

test('chat senza pagina web: lo dice', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await fornitore(app);
  const a = await chiediTraduzione(app, shell, {}, 'traducimi questa pagina');
  console.log('ESITO-VUOTO', a.esito);
  console.log('RIGA-VUOTO', await a.home.locator('.dash-activity').last().innerText());
  await ripristina(app);
});

test('Aiuto sulla pagina: «traducimi questa pagina»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitore(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' } });
    const P = globalThis.SN_PROVIDERS;
    const tr = P.completeWithFallback;
    globalThis.__aiuto = [];
    const aiuto = (attempts, messages) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{}' };
      globalThis.__aiuto.push(JSON.parse(JSON.stringify(messages)));
      return { ...base,
        text: JSON.stringify({ action: 'filo', filo: { type: 'TRADUCI_PAGINA' }, text: 'Traduco la pagina.', status: 'done' }) };
    };
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      if (((last && last.content) || '').includes('@@@SN_SEP@@@')) return tr(args);
      return aiuto(args.attempts, args.messages);
    };
    P.streamCompleteWithFallback = async (args) => aiuto(args.attempts, args.messages);
  });
  const page = await testServer.openReady(openTab, ARTICLE);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const pannello = await paginaDellAiuto(app, page);
  await pannello.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await pannello.fill('.sn-sidebar-input textarea', 'traducimi questa pagina');
  await pannello.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__aiuto.length), { timeout: 20_000 }).toBeGreaterThan(0);
  const prompt = JSON.stringify(await app.evaluate(() => globalThis.__aiuto[0]));
  console.log('AIUTO-PROMPT-HA-TRADUCI', prompt.includes('TRADUCI_PAGINA'), /tradu[a-z]* (la|questa|l'intera) pagina/i.test(prompt));
  await page.waitForTimeout(5000);
  console.log('AIUTO-TITOLO', await page.locator('#title').innerText());
  console.log('AIUTO-LOG', await pannello.locator('.sn-sidebar').innerText().catch(() => '?'));
  await pannello.screenshot({ path: 'tests/.shots/v504-aiuto.png' });
});

test('Alt+T senza selezione sulla pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitore(app);
  const page = await testServer.openReady(openTab, ARTICLE);
  await page.locator('#p1').click();
  await page.keyboard.press('Alt+t');
  await page.waitForTimeout(4000);
  console.log('ALT-T', await page.locator('#title').innerText());
});

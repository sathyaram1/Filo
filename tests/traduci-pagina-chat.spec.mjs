// #504 — «Traduci la pagina» si chiede anche a Filo in chat: traduce, riprende, prende il testo arrivato dopo, torna
// all'originale. A parole «traduci» non torna mai indietro come farebbe l'icona su una pagina già tradotta, e Filo sa
// dire com'è andata. Il fornitore finto antepone "IT " a ogni blocco, come in translate-page.spec.mjs.

import { test, expect } from './fixtures/electron.mjs';

const ARTICOLO = `<!doctype html><html lang="en"><head><title>An English article</title></head>
<body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A feed that keeps growing while you scroll it</h1>
  <div id="feed">
    <div id="r0">First row of the feed, written in English.</div>
    <div id="r1">Second row of the feed, written in English.</div>
  </div>
  <script>
    window.__addRows = (n) => {
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        d.id = 'later' + i;
        d.textContent = 'Row number ' + i + ' arrived after the translation was done.';
        document.getElementById('feed').appendChild(d);
      }
    };
  </script>
</body></html>`;

// Più richieste da ~3000 caratteri: serve allo stato «a metà».
const LUNGA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A very long English article about nothing in particular</h1>
  ${Array.from({ length: 40 }, (_, i) => '<p id="p' + i + '">Paragraph number ' + i + ' of the body text, deliberately long enough to take a meaningful share of the request budget so that the article needs several separate requests to be translated in full.</p>').join('\n  ')}
</body></html>`;

// `fallisceDopo`: richieste servite prima di dare un guasto di rete (-1 mai); `ritardo` fa durare ogni richiesta.
async function fornitoreFinto(app, { fallisceDopo = -1, ritardo = 0 } = {}) {
  await app.evaluate(async (_electron, { fallisceDopo, ritardo }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoChiamate = 0;
    globalThis.__filoBlocchi = 0;
    globalThis.__filoFallisceDopo = fallisceDopo;
    const prima = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return prima(args);
      globalThis.__filoChiamate++;
      if (ritardo > 0) await new Promise((r) => setTimeout(r, ritardo));
      const cap = globalThis.__filoFallisceDopo;
      if (cap >= 0 && globalThis.__filoChiamate > cap) throw new Error('fetch failed');
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const parti = (i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '').split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoBlocchi += parti.length;
      return { text: parti.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  }, { fallisceDopo, ritardo });
}

// Come la chat della home: il mittente è la finestra, con l'indirizzo della home (zoom-chat.spec.mjs).
const chiedi = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents, url: 'filo://newtab/' } });
  }, { action });
// Quello che torna al modello dopo l'azione: da qui dice all'utente com'è andata.
const perIlModello = (app, action, res) => app.evaluate((_electron, { action, res }) => {
  const rq = process.mainModule.require;
  const O = rq(rq('node:path').join(process.cwd(), 'src/main/services/osservazioniPerModello.js'));
  return O.toolResultText({ action, res, rendered: null });
}, { action, res });
const traduci = (app) => chiedi(app, { type: 'TRADUCI_PAGINA' });
const originale = (app) => chiedi(app, { type: 'TRADUCI_PAGINA', originale: true });

const tradotti = (page) => page.evaluate(() => document.querySelectorAll('[data-sn-translated="1"]').length);
const doppi = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-sn-translated="1"]'))
  .filter((el) => /^IT\s+IT\s/.test(el.textContent || '')).length);
const blocchi = (app) => app.evaluate(() => globalThis.__filoBlocchi);

// Gli avvisi durano pochi secondi: si raccolgono man mano che compaiono.
const guardaAvvisi = (page) => page.evaluate(() => {
  window.__avvisi = [];
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__avvisi.push(n.textContent || '');
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
});
const avvisi = (page) => page.evaluate(() => window.__avvisi || []);

test('«traducimi la pagina»: si traduce; chiesto di nuovo resta tradotta; «torna all\'originale» la rimette', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await guardaAvvisi(page);

  const r = await traduci(app);
  expect(r.executed).toBe(true);
  expect(r.output).toMatchObject({ traduzione: 'partita', come: 'pagina' });
  await expect(page.locator('#head')).toHaveText(/^IT A feed/, { timeout: 30000 });
  await expect(page.locator('#r1')).toHaveText(/^IT Second row/);
  await expect.poll(() => page.title(), { timeout: 30000 }).toMatch(/^IT /);
  // Sulla pagina gli stessi avvisi del clic: a che punto è, poi com'è finita.
  await expect.poll(async () => (await avvisi(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  await page.screenshot({ path: 'tests/.shots/traduci-pagina-chat-tradotta.png' }).catch(() => {});

  // L'icona su una pagina tradotta torna all'originale; la frase no: Filo dice che è già fatto.
  await expect.poll(async () => (await traduci(app)).output.traduzione, { timeout: 30000 }).toBe('gia_tradotta');
  await expect(page.locator('#head')).toHaveText(/^IT A feed/);

  const via = await originale(app);
  expect(via.executed).toBe(true);
  expect(via.output.traduzione).toBe('originale');
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it');
  await expect(page.locator('#r1')).toHaveText('Second row of the feed, written in English.');
  expect(await tradotti(page)).toBe(0);

  const ancora = await originale(app);
  expect(ancora.executed).toBe(true);
  expect(ancora.output.traduzione).toBe('niente');
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it');
});

test('«traduci anche il testo nuovo»: solo le righe arrivate dopo vanno al modello', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await traduci(app);
  await expect(page.locator('#r1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await traduci(app)).output.traduzione, { timeout: 30000 }).toBe('gia_tradotta');
  const pagati = await blocchi(app);

  await page.evaluate(() => window.__addRows(4));
  await expect(page.locator('#later3')).toHaveText(/^Row number 3 /);
  await expect.poll(async () => {
    const r = await traduci(app);
    return r.output.traduzione === 'partita' ? r.output.come : r.output.traduzione;
  }, { timeout: 15000 }).toBe('nuovo');

  for (const id of ['#later0', '#later3']) await expect(page.locator(id)).toHaveText(/^IT /, { timeout: 30000 });
  expect(await doppi(page)).toBe(0);
  expect(await blocchi(app) - pagati).toBe(4);
});

test('«riprendi la traduzione»: riparte da dove si era fermata e non ripaga la parte fatta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await fornitoreFinto(app, { fallisceDopo: 1 });
  const page = await testServer.openReady(openTab, LUNGA);
  await guardaAvvisi(page);
  await traduci(app);
  await expect.poll(async () => (await avvisi(page)).some((t) => t.startsWith('Traduzione interrotta')), { timeout: 30000 }).toBe(true);
  const prima = await tradotti(page);
  expect(prima).toBeGreaterThan(0);
  expect(prima).toBeLessThan(41);

  await app.evaluate(() => { globalThis.__filoFallisceDopo = -1; });
  const r = await traduci(app);
  expect(r.executed).toBe(true);
  expect(r.output).toMatchObject({ traduzione: 'partita', come: 'ripresa' });
  expect(r.output.mancanti).toBeGreaterThan(0);
  expect(r.output.di).toBeGreaterThan(r.output.mancanti);

  await expect.poll(() => tradotti(page), { timeout: 60000 }).toBe(41);
  for (const id of ['#head', '#p0', '#p39']) await expect(page.locator(id)).toHaveText(/^IT /);
  expect(await doppi(page)).toBe(0);
});

test('«torna all\'originale» mentre traduce: si ferma e la pagina resta com\'era', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app, { ritardo: 3000 });
  const page = await testServer.openReady(openTab, ARTICOLO);
  expect((await traduci(app)).output.traduzione).toBe('partita');
  expect((await traduci(app)).output.traduzione).toBe('in_corso');

  const via = await originale(app);
  expect(via.output.traduzione).toBe('fermata');
  // Le risposte già spedite tornano dopo, e non devono ritradurre la pagina.
  await page.waitForTimeout(4000);
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it');
  expect(await tradotti(page)).toBe(0);
});

test('nessuna pagina web aperta: Filo lo dice, invece di dire fatto', async ({ app, shell }) => {
  await expect(shell.locator('body')).toBeVisible();
  const r = await traduci(app);
  expect(r.executed).toBe(false);
  expect(r.output.traduzione).toBe('no-page');
});

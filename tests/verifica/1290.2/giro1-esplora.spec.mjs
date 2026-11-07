// Verifica #1290.2 giro 1: le porte vicine ai sette rilievi del giro 2 di #1290 (traduzione della pagina).
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, premiNellaBarra } from '../../helpers/barra.mjs';

async function stubTranslationProvider(app, delayMs = 0) {
  await app.evaluate(async (_electron, delay) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslatePrompts = [];
    const origComplete = globalThis.__origComplete12902 || P.completeWithFallback;
    globalThis.__origComplete12902 = origComplete;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoTranslatePrompts.push(chunk);
      return { text: parts.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  }, delayMs);
}

async function soloQuandoApro(app) {
  const r = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'traduzione delle sezioni nascoste', valore: 'solo quando apro' }, { sender: null }));
  expect(r.executed).toBe(true);
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}
const toasts = (page) => page.evaluate(() => window.__toasts || []);
const clickTranslateIcon = (app) => premiNellaBarra(app, 'translate');
const sentText = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));

async function iconaTraduci(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'chiudi');
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.barra;
    b.etichettePagina = null;
    b._invia();
  });
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra.locator('#nav .ico[data-id="translate"]');
}

const frameInner = (token) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
  <p id="fbody">${token} an embedded box written in english and long enough to count as text.</p>
</body></html>`;
const framePage = (frames) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article that carries a few embedded boxes around it</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  ${frames}
</body></html>`;

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
async function immagineLenta(ms) {
  const server = createServer((_req, res) => {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/gif' }); res.end(Buffer.from(PIXEL.split(',')[1], 'base64')); }, ms);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/foto.gif`,
    chiudi: () => { try { server.closeAllConnections?.(); server.close(); } catch (_) {} },
  };
}

test('A riquadro avvolto in un componente aperto che finisce di caricarsi dopo: niente «testo nuovo»', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const foto = await immagineLenta(7000);
  try {
    const src = testServer.html(`<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
      <p id="fbody">ZZWRAP an embedded post written in english and long enough to count as text.</p>
      <img src="${foto.url}" width="40" height="40" alt=""></body></html>`).replace('127.0.0.1', 'blocked.test');
    const page = await testServer.openReady(openTab, framePage(`<embed-post></embed-post>
      <script>customElements.define('embed-post', class extends HTMLElement { connectedCallback() {
        this.attachShadow({ mode: 'open' }).innerHTML = '<iframe id="emb" src="${src}" style="width:520px;height:220px"></iframe>'; } });</script>`));
    const riquadro = () => page.frames().find((f) => f.url().includes('blocked.test'));
    await expect.poll(() => !!riquadro(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => riquadro().evaluate(() => (document.getElementById('fbody') || {}).textContent || ''), { timeout: 30000 }).toMatch(/^ZZWRAP /);
    expect(await riquadro().evaluate(() => document.readyState)).not.toBe('complete');
    await watchToasts(page);
    await clickTranslateIcon(app);
    await expect.poll(() => riquadro().evaluate(() => document.getElementById('fbody').textContent), { timeout: 60000 }).toMatch(/^IT ZZWRAP /);
    await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 60000 }).toBe(true);
    await expect.poll(() => riquadro().evaluate(() => document.readyState), { timeout: 30000 }).toBe('complete');
    await page.waitForTimeout(800);
    await expect(await iconaTraduci(app)).toHaveAttribute('aria-label', 'Mostra originale');
  } finally { foto.chiudi(); }
});

test('B di serie un riquadro da un pixel spento con display:none non va al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const cross = (token) => testServer.html(frameInner(token)).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`
    <iframe src="${cross('ZZNONE')}" width="1" height="1" style="display:none"></iframe>
    <iframe id="big" src="${cross('ZZBIG')}" style="opacity:0;width:520px;height:220px"></iframe>`));
  await page.waitForTimeout(1000);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(async () => (await sentText(app)).includes('ZZBIG'), { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 60000 }).toBe(true);
  await page.waitForTimeout(1500);
  expect(await sentText(app)).not.toContain('ZZNONE');
});

test('C componente chiuso con dentro solo testo che la traduzione salta per scelta del sito: «Pagina tradotta»', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
    <h1 id="head">A page with a brand widget sealed by the site</h1>
    <p id="p1">First paragraph of the page, long enough to be picked up by the translation.</p>
    <brand-box style="display:block;width:600px;height:120px"></brand-box>
    <script>customElements.define('brand-box', class extends HTMLElement { connectedCallback() {
      this.attachShadow({ mode: 'closed' }).innerHTML = '<div class="notranslate" style="font-size:40px">Acme Widget Pro</div>'
        + '<div translate="no">Acme Corporation Limited</div>';
    } });</script>
  </body></html>`);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  expect((await toasts(page)).join(' | ')).not.toContain('solo in parte');
});

const SIGILLATO = (prima, dopo, stile = '') => `<!doctype html><html lang="en"><head><style>${stile}</style></head><body style="font:16px sans-serif;padding:20px">
  <h1 id="plain">A plain heading outside any component</h1>
  <p id="p1">First paragraph of the article, long enough to be picked up by the translation.</p>
  ${prima}<closed-card></closed-card>${dopo}
  <script>
    customElements.define('closed-card', class extends HTMLElement {
      connectedCallback() {
        this.attachShadow({ mode: 'closed' }).innerHTML = '<h2>Headline locked inside a closed component</h2><p>Body text nobody outside can read.</p>';
      }
    });
  </script>
</body></html>`;

for (const [nome, prima, dopo, stile] of [
  ['chiusa da una classe del sito', '<button>Show more</button><div class="more"><p id="psez">A paragraph inside the folded section, long enough to be translated.</p>', '</div>', '.more{display:none}'],
  ['schiacciata a zero', '<button>Show more</button><div style="max-height:0;overflow:hidden"><p id="psez">A paragraph inside the folded section, long enough to be translated.</p>', '</div>', ''],
  ['resa invisibile', '<button>Show more</button><div style="visibility:hidden"><p id="psez">A paragraph inside the folded section, long enough to be translated.</p>', '</div>', ''],
]) {
  test(`D componente chiuso con testo in una sezione ${nome}, accanto a un paragrafo: «solo in parte»`, async ({ app, openTab, testServer }) => {
    await stubTranslationProvider(app);
    const page = await testServer.openReady(openTab, SIGILLATO(prima, dopo, stile));
    await watchToasts(page);
    await clickTranslateIcon(app);
    await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
    await expect(page.locator('#psez')).toHaveText(/^IT /, { timeout: 30000 });
    await expect.poll(async () => (await toasts(page)).join(' | '), { timeout: 30000 }).toContain('solo in parte');
  });
}

const PIEGATA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with a folded section</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  <p id="p2">Second paragraph of the body text, also long enough to be picked up by the translation.</p>
  <button id="apri" onclick="document.getElementById('sez').hidden = false">Show more</button>
  <div id="sez" hidden><p id="psez">A paragraph inside the folded section, long enough to be translated.</p></div>
</body></html>`;

test('E solo quando apro: la sezione aperta mentre la traduzione lavora si traduce lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app, 4000);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, PIEGATA);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(async () => (await toasts(page)).join(' | '), { timeout: 10000 }).toMatch(/[Tt]raduc/);
  await page.locator('#apri').click();
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.locator('#psez')).toHaveText(/^IT /, { timeout: 15000 });
});

test('F solo quando apro: dopo «Mostra originale» la sezione aperta resta com\'è', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, PIEGATA);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  await clickTranslateIcon(app);
  await expect(page.locator('#p1')).not.toHaveText(/^IT /, { timeout: 10000 });
  await page.locator('#apri').click();
  await page.waitForTimeout(3000);
  await expect(page.locator('#psez')).not.toHaveText(/^IT /);
  expect(await sentText(app)).not.toContain('folded section');
});

// Verifica #1290.2 giro 2: porte della traduzione pagina provate dal verificatore.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, premiNellaBarra } from '../../helpers/barra.mjs';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

async function stub(app, delay = 0) {
  await app.evaluate(async (_e, delay) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslatePrompts = [];
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      globalThis.__filoTranslatePrompts.push(chunk);
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n');
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  }, delay);
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
const toasts = async (page) => (await page.evaluate(() => window.__toasts || [])).join(' | ');
const sentText = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));
const clickTranslateIcon = (app) => premiNellaBarra(app, 'translate');

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

const frameInner = (token, extra = '') => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
  <p id="fbody">${token} an embedded box written in english and long enough to count as text.</p>${extra}
</body></html>`;
const framePage = (frames) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article that carries a few embedded boxes around it</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  ${frames}
</body></html>`;

// A: riquadro riempito dalla pagina (srcdoc, o scritto a mano come gli spazi pubblicitari) che finisce di caricarsi dopo.
for (const [nome, html] of [
  ['scritto nel srcdoc', (img) => `<iframe id="emb" style="width:520px;height:220px" srcdoc="${frameInner('ZZSRCDOC', `<img src='${img}' width='40' height='40' alt=''>`).replace(/"/g, '&quot;')}"></iframe>`],
  ['scritto dalla pagina', (img) => `<iframe id="emb" style="width:520px;height:220px"></iframe><script>
    window.__scrivi = () => { const d = document.getElementById('emb').contentDocument; d.open();
    d.write(${JSON.stringify(frameInner('ZZSRCDOC', `<img src="${img}" width="40" height="40" alt="">`))}); d.close(); };
    setTimeout(window.__scrivi, 300);</script>`],
]) {
  test(`A riquadro ${nome} che finisce di caricarsi dopo Traduci: tradotto, e niente «testo nuovo»`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120000);
    await stub(app);
    const foto = await immagineLenta(7000);
    try {
      const page = await testServer.openReady(openTab, framePage(html(foto.url)));
      const riq = page.frameLocator('#emb');
      await expect(riq.locator('#fbody')).toHaveText(/^ZZSRCDOC /, { timeout: 30000 });
      const f = () => page.frames().find((x) => x !== page.mainFrame());
      expect(await f().evaluate(() => document.readyState)).not.toBe('complete');
      await watchToasts(page);
      await clickTranslateIcon(app);
      await expect(riq.locator('#fbody')).toHaveText(/^IT ZZSRCDOC /, { timeout: 60000 });
      await expect.poll(() => toasts(page), { timeout: 60000 }).toContain('Pagina tradotta');
      await expect.poll(() => f().evaluate(() => document.readyState), { timeout: 30000 }).toBe('complete');
      await page.waitForTimeout(800);
      expect(await toasts(page)).not.toContain('aggiunta');
      await expect(await iconaTraduci(app)).toHaveAttribute('aria-label', 'Mostra originale');
    } finally { foto.chiudi(); }
  });
}

// B: solo quando apro, dopo «Mostra originale» aprire una sezione non la traduce.
const PIEGATA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article with a folded part</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  <p id="p2">Second paragraph of the body text, also long enough to be picked up by the translation.</p>
  <button id="apri" onclick="document.getElementById('sez').hidden = false">Show more</button>
  <div id="sez" hidden><p id="psez">A paragraph inside the folded section, long enough to be translated.</p></div>
  <details id="det"><summary id="sum">Open the details</summary><p id="pdet">A paragraph inside a details element, long enough to count.</p></details>
</body></html>`;

test('B solo quando apro: dopo «Mostra originale» la sezione aperta resta nella lingua originale', async ({ app, openTab, testServer }) => {
  await stub(app);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, PIEGATA);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  const icon = await iconaTraduci(app);
  await expect(icon).toHaveAttribute('aria-label', 'Mostra originale');
  await icon.click();
  await expect(page.locator('#p1')).not.toHaveText(/^IT /, { timeout: 15000 });
  await page.locator('#apri').click();
  await page.waitForTimeout(4000);
  await expect(page.locator('#psez')).not.toHaveText(/^IT /);
  await expect(page.locator('#p1')).not.toHaveText(/^IT /);
});

test('C solo quando apro: la fisarmonica aperta mentre la traduzione lavora si traduce anche lei', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stub(app, 4000);
  await soloQuandoApro(app);
  const page = await testServer.openReady(openTab, PIEGATA);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 10000 }).toContain('in corso');
  await page.locator('#sum').click();
  expect(await toasts(page)).not.toContain('Pagina tradotta');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.locator('#pdet')).toHaveText(/^IT /, { timeout: 15000 });
});

test('D solo quando apro: aperta una sezione con dentro un riquadro, il riquadro si traduce da solo', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stub(app);
  await soloQuandoApro(app);
  const cross = (token) => testServer.html(frameInner(token)).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`
    <details id="d"><summary id="sum">Show the comments</summary>
      <iframe id="folded" src="${cross('ZZFOLD')}" style="width:520px;height:220px"></iframe></details>`));
  await page.waitForTimeout(1000);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  expect(await sentText(app)).not.toContain('ZZFOLD');
  await page.locator('#sum').click();
  await expect(page.frameLocator('#folded').locator('#fbody')).toHaveText(/^IT ZZFOLD /, { timeout: 15000 });
});

test('E solo quando apro: la sezione aperta dentro un riquadro incorporato si traduce da sola', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stub(app);
  await soloQuandoApro(app);
  const src = testServer.html(frameInner('ZZEMB', `<button id="apri" onclick="document.getElementById('sez').hidden = false">Read more</button>
    <div id="sez" hidden><p id="fsez">ZZSEZ the rest of the embedded post, hidden until the reader opens it.</p></div>`)).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`<iframe id="emb" src="${src}" style="width:520px;height:260px"></iframe>`));
  await page.waitForTimeout(1000);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.frameLocator('#emb').locator('#fbody')).toHaveText(/^IT ZZEMB /, { timeout: 60000 });
  await expect.poll(() => toasts(page), { timeout: 30000 }).toContain('Pagina tradotta');
  expect(await sentText(app)).not.toContain('ZZSEZ');
  await page.frameLocator('#emb').locator('#apri').click();
  await expect(page.frameLocator('#emb').locator('#fsez')).toHaveText(/^IT ZZSEZ /, { timeout: 15000 });
});

test('F di serie i riquadri di tracciamento spenti dal sito nei modi comuni non vanno al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stub(app);
  const cross = (token) => testServer.html(frameInner(token)).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`
    <iframe src="${cross('ZZZERO')}" width="0" height="0" style="display:none;visibility:hidden"></iframe>
    <div style="display:none"><iframe src="${cross('ZZPARENT')}" width="1" height="1"></iframe></div>
    <iframe src="${cross('ZZCSS')}" style="display:none;width:1px;height:1px"></iframe>
    <div style="display:none"><iframe src="${cross('ZZTAB')}" style="width:520px;height:220px"></iframe></div>`));
  await page.waitForTimeout(1000);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect.poll(async () => (await sentText(app)).includes('ZZTAB'), { timeout: 60000 }).toBe(true);
  await expect.poll(() => toasts(page), { timeout: 60000 }).toContain('Pagina tradotta');
  await page.waitForTimeout(1500);
  const sent = await sentText(app);
  expect(['ZZZERO', 'ZZPARENT', 'ZZCSS'].filter((t) => sent.includes(t))).toEqual([]);
});

test('G componente chiuso con un segnaposto di riserva e il contenuto messo dalla pagina: «Pagina tradotta»', async ({ app, openTab, testServer }) => {
  await stub(app);
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
    <h1 id="head">A page whose cards are built with sealed components</h1>
    <p id="p1">First paragraph of the page, long enough to be picked up by the translation.</p>
    <slot-card style="display:block;width:600px;height:120px"><span id="slotted">The card title written by the page itself</span></slot-card>
    <script>
      customElements.define('slot-card', class extends HTMLElement { connectedCallback() {
        this.attachShadow({ mode: 'closed' }).innerHTML = '<div style="border:1px solid #ccc;padding:8px"><slot>Untitled card</slot></div>';
      } });
    </script>
  </body></html>`);
  await watchToasts(page);
  await clickTranslateIcon(app);
  await expect(page.locator('#slotted')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 30000 }).toMatch(/tradotta/);
  expect(await toasts(page)).not.toContain('solo in parte');
});

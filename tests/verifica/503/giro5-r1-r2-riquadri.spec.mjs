import { test, expect } from '../../fixtures/electron.mjs';

// Finta traduzione nel main: "IT " davanti a ogni blocco, separatori e
// segnaposto [[Lk]] intatti. `delayMs` fa durare ogni richiesta: serve agli
// scenari in cui conta cosa succede MENTRE la traduzione lavora (il sito che
// allunga la pagina, l'utente che chiede l'originale a metà).
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
    globalThis.__filoTranslateCalls = 0;
    // Blocchi effettivamente MANDATI al modello: è la misura di quanto l'utente
    // paga. Serve a provare che una ripresa non rispedisce ciò che è già fatto.
    globalThis.__filoTranslateBlocks = 0;
    // Il TESTO davvero spedito, richiesta per richiesta: è l'unico modo di
    // provare che una frase non parte due volte (una dal testo e una
    // dall'etichetta che lo ripete).
    globalThis.__filoTranslatePrompts = [];
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      // Nella pagina girano anche altre chiamate AI (es. controllo dominio):
      // qui ci interessano SOLO quelle di traduzione pagina.
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      globalThis.__filoTranslateCalls++;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      // Modello che risponde A VUOTO: nessun errore, nessun testo. Serve a
      // provare che l'avviso non inventa un guasto che non c'è stato.
      if (prompt.indexOf('ZULU') >= 0) {
        return { text: '', provider: 'test', model: 'test-translate', usage: {} };
      }
      // #593 — il testo da tradurre arriva al modello dentro una busta, come
      // ogni altro contenuto che scrive il sito: qui si finge di leggerla
      // come la leggerebbe lui.
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoTranslateBlocks += parts.length;
      globalThis.__filoTranslatePrompts.push(chunk);
      const out = parts.map((p) => `IT ${p}`).join(SEP);
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  }, delayMs);
}

// Raccoglie i toast man mano che compaiono (durano pochi secondi: un assert
// a campione sarebbe race-prone).
async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) {
            window.__toasts.push(n.textContent || '');
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const toasts = (page) => page.evaluate(() => window.__toasts || []);

async function clickTranslateIcon(page, anchor = 'body') {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

const frameInner = (token) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
  <p id="fbody">${token} an embedded box written in english and long enough to count as text.</p>
</body></html>`;
const framePage = (frames) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article that carries a few embedded boxes around it</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  ${frames}
</body></html>`;
const sentText = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));


// #503 giro 5 — prove della verifica: un riquadro che l'utente non vede non fa dire «tranne un riquadro incorporato»
// e non si paga, comunque la pagina sia scorsa; uno che si vede si traduce e si conta.

test('r1 pagina già scorsa: i riquadri trasparenti in cima non fanno uscire l’avviso e non si pagano', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const cross = testServer.html(frameInner('ZZTOPFADE')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`
    <iframe sandbox src="${testServer.html(frameInner('ZZLOCK'))}" style="opacity:0;width:300px;height:200px;border:0"></iframe>
    <iframe src="${cross}" style="opacity:0;width:300px;height:200px;border:0"></iframe>
    <div style="height:3000px"></div>
    <p id="p9">A paragraph far down the page that the reader has reached by scrolling.</p>`));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  await watchToasts(page);
  await clickTranslateIcon(page, '#p9');
  await expect(page.locator('#p9')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).join(' | '), { timeout: 30000 }).toContain('Pagina tradotta');
  await page.waitForTimeout(2500);
  expect((await toasts(page)).join(' | ')).not.toContain('riquadro incorporato');
  expect(await sentText(app)).not.toContain('ZZTOPFADE');
});

test('r2 contenuto visibile segnato come nascosto ai lettori di schermo: si traduce, riquadro compreso', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(frameInner('ZZARIA')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, framePage(`<div aria-hidden="true">
    <p id="ap">Visible paragraph inside a wrapper hidden from screen readers, long enough to count.</p>
    <iframe id="emb" src="${src}" style="width:520px;height:220px"></iframe></div>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.frameLocator('#emb').locator('#fbody')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.locator('#ap')).toHaveText(/^IT /, { timeout: 30000 });
});

test('r2 riquadro chiuso a chiave visibile ma segnato come nascosto ai lettori di schermo: l’avviso lo confessa', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, framePage(
    `<iframe sandbox aria-hidden="true" src="${testServer.html(frameInner('ZZLOCK'))}" style="width:520px;height:220px"></iframe>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).join(' | '), { timeout: 60000 }).toContain('riquadro incorporato');
});

// Sonde finali: quali pezzi di una pagina VERA restano in lingua originale
// mentre l'avviso dice "Pagina tradotta", e quanto testo viene spedito due volte.
import { test, expect } from './fixtures/electron.mjs';

async function stub(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__sent = [];
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      for (const p of parts) globalThis.__sent.push(p);
      return { text: parts.map((p) => `IT ${p}`).join(SEP), provider: 'test', model: 'test-translate', usage: {} };
    };
  });
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

async function translate(page, anchor) {
  const el = page.locator(anchor).first();
  await el.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  await el.click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

// Un portale aziendale che usa il prefisso di classe "sn-" per i propri
// componenti (ServiceNow lo fa davvero) e un id che comincia per "filo-".
const PREFIXES = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:24px">
  <h1 id="ok">A headline that should change language</h1>
  <div class="sn-card"><h2 id="snTitle">Incident summary for this request</h2>
    <p id="snBody">The description of the incident, written in English by the portal.</p></div>
  <div id="filo-thread"><p id="filoBody">A discussion thread rendered by the portal.</p></div>
  <div class="notranslate" id="nt">Brand name kept as is by the site</div>
</body></html>`;

test('sonda: prefissi di classe/id che Filo scambia per la propria UI', async ({ app, openTab, testServer }) => {
  await stub(app);
  const page = await testServer.openReady(openTab, PREFIXES);
  await watchToasts(page);
  await translate(page, '#ok');
  await expect(page.locator('#ok')).toHaveText(/^IT /);
  await page.waitForTimeout(1200);
  console.log('PREFIXES:', JSON.stringify({
    ok: await page.locator('#ok').textContent(),
    snTitle: await page.locator('#snTitle').textContent(),
    snBody: await page.locator('#snBody').textContent(),
    filoBody: await page.locator('#filoBody').textContent(),
    nt: await page.locator('#nt').textContent(),
    toasts: await page.evaluate(() => window.__toasts),
  }, null, 1));
  await page.screenshot({ path: 'tests/.shots/407-prefissi.png' });
});

// Attributi che ripetono il testo già visibile: si pagano due volte?
const DUP = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:24px">
  <a id="a1" href="#x" title="Read more about the final match">Read more about the final match</a>
  <button id="b1" aria-label="Close the newsletter box">Close the newsletter box</button>
  <p id="p1">A paragraph of ordinary body text to keep the page realistic.</p>
</body></html>`;

test('sonda: testo mandato due volte (attributo uguale al testo visibile)', async ({ app, openTab, testServer }) => {
  await stub(app);
  const page = await testServer.openReady(openTab, DUP);
  await watchToasts(page);
  await translate(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await page.waitForTimeout(1000);
  const sent = await app.evaluate(() => globalThis.__sent);
  console.log('DUP blocchi spediti:', JSON.stringify(sent, null, 1));
});

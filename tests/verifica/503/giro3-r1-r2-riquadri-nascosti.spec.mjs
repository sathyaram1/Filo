// Verifica #503 giro 3: i riquadri dentro un riquadro riempito dalla pagina non sfuggono al giudizio (r1);
// i modi meno comuni di nascondere un riquadro chiuso a chiave non fanno uscire l’avviso a vuoto (r2).
import { test, expect } from '../../fixtures/electron.mjs';

async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslatePrompts = [];
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const parts = chunk.split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoTranslatePrompts.push(chunk);
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
const toasts = async (page) => (await page.evaluate(() => window.__toasts || [])).join(' | ');
const sent = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));

async function clickTranslateIcon(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

const INNER = (tag) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;margin:0;padding:10px">
  <p id="fbody">${tag} an advertising slot written in english and long enough to count as text.</p>
</body></html>`;

const pagina = (frames) => `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">An article that carries a few embedded boxes around it</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up by the translation.</p>
  ${frames}
</body></html>`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

async function run(app, page) {
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await page.waitForTimeout(6000);
  return { t: await toasts(page), s: await sent(app) };
}

const wrapOf = (src) => `<!doctype html><html><body style="margin:0"><iframe id="in" src="${src}" style="width:300px;height:200px;border:0"></iframe></body></html>`;

test('r1 riquadro con script dentro un riquadro della pagina trasparente: non si paga e non copre quello chiuso a chiave che si vede', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const a = testServer.html(INNER('ZZVISIBLE')).replace('127.0.0.1', 'blocked.test');
  const lock = testServer.html(INNER('ZZLOCK'));
  const inner = testServer.html(INNER('ZZNEST')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, pagina(`<iframe id="a" src="${a}" style="width:520px;height:120px"></iframe>
    <iframe id="lock" sandbox src="${lock}" style="width:520px;height:120px"></iframe>
    <iframe id="emb" srcdoc="${esc(wrapOf(inner))}" style="opacity:0;width:320px;height:220px"></iframe>`));
  await page.waitForTimeout(1500);
  const { t, s } = await run(app, page);
  expect(s, 'il riquadro nascosto è stato spedito al modello').not.toContain('ZZNEST');
  expect(t, 'il riquadro chiuso a chiave visibile non è stato confessato').toContain('riquadro incorporato');
});

test('r1 riquadro con script dentro un riquadro della pagina visibile: si traduce', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const inner = testServer.html(INNER('ZZVIS')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, pagina(`<iframe id="emb" srcdoc="${esc(wrapOf(inner))}" style="width:320px;height:220px"></iframe>`));
  await page.waitForTimeout(1500);
  await run(app, page);
  await expect(page.frameLocator('#emb').frameLocator('#in').locator('#fbody')).toHaveText(/^IT /, { timeout: 30000 });
});

const NASCOSTI = [
  ['spostato fuori con una trasformazione', 'transform:translateX(-9999px);width:300px;height:250px'],
  ['ritagliato col vecchio clip', 'position:absolute;clip:rect(0 0 0 0);width:300px;height:250px'],
  ['ritagliato con un cerchio nullo', 'clip-path:circle(0);width:300px;height:250px'],
  ['spinto a destra oltre una pagina che non scorre di lato', 'position:absolute;left:100%;top:0;width:300px;height:250px'],
];
for (const [nome, stile] of NASCOSTI) {
  test(`r2 riquadro chiuso a chiave ${nome}: «Pagina tradotta», senza avviso a vuoto`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120000);
    await stubTranslationProvider(app);
    const src = testServer.html(INNER('ZZLOCK'));
    const page = await testServer.openReady(openTab, pagina(`<iframe id="emb" sandbox src="${src}" style="border:0;${stile}"></iframe>`).replace('<body style="', '<body style="overflow-x:hidden;'));
    const { t } = await run(app, page);
    expect(t).toContain('Pagina tradotta');
    expect(t).not.toContain('riquadro incorporato');
  });
}

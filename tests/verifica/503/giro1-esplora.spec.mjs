// Verifica #503 giro 1: i riquadri incorporati che l'utente non vede non fanno
// scattare l'avviso «tranne un riquadro incorporato» e non si pagano; quelli
// raggiungibili scorrendo restano contati e tradotti.
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

// Pagina tradotta, nessun avviso sul riquadro: aspetta l'esito finale.
async function esito(page) {
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 60000 }).toMatch(/Pagina tradotta/);
  return toasts(page);
}

const NASCOSTI = [
  ['portato fuori dallo schermo', 'position:absolute;left:-9999px;top:0;width:300px;height:250px'],
  ['trasparente', 'opacity:0;width:300px;height:250px'],
  ['nascosto lasciando l’ingombro', 'visibility:hidden;width:300px;height:250px'],
  ['banner fisso sotto il bordo', 'position:fixed;left:0;bottom:-600px;width:300px;height:250px'],
  ['mascherato via', 'clip-path:inset(100%);width:300px;height:250px'],
  ['trasparente per un filtro', 'filter:opacity(0);width:300px;height:250px'],
];

for (const [nome, stile] of NASCOSTI) {
  test(`riquadro chiuso a chiave e ${nome}: «Pagina tradotta», senza avviso a vuoto`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120000);
    await stubTranslationProvider(app);
    const src = testServer.html(INNER('ZZLOCK'));
    const page = await testServer.openReady(openTab, pagina(`<iframe id="emb" sandbox src="${src}" style="border:0;${stile}"></iframe>`));
    await watchToasts(page);
    await clickTranslateIcon(page, '#p1');
    await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
    await page.waitForTimeout(4000);
    const t = await toasts(page);
    expect(t).not.toContain('riquadro incorporato');
    expect(t).toContain('Pagina tradotta');
  });
}

test('riquadro nascosto dentro un contenitore trasparente: nessun avviso a vuoto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(INNER('ZZLOCK'));
  const page = await testServer.openReady(openTab, pagina(`<div style="opacity:0"><iframe id="emb" sandbox src="${src}" style="border:0;width:300px;height:250px"></iframe></div>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await page.waitForTimeout(4000);
  const t = await toasts(page);
  expect(t).not.toContain('riquadro incorporato');
  expect(t).toContain('Pagina tradotta');
});

test('riquadro chiuso a chiave più in basso della prima schermata: resta contato', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(INNER('ZZLOCK'));
  const page = await testServer.openReady(openTab, pagina(`<div style="height:2500px"></div><iframe id="emb" sandbox src="${src}" style="width:520px;height:220px"></iframe>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 60000 }).toContain('riquadro incorporato');
});

test('riquadro chiuso a chiave in fondo a un pannello che scorre: resta contato', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(INNER('ZZLOCK'));
  const page = await testServer.openReady(openTab, pagina(`<div style="height:200px;overflow:auto;border:1px solid #ccc"><div style="height:900px"></div><iframe id="emb" sandbox src="${src}" style="width:420px;height:200px"></iframe></div>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(() => toasts(page), { timeout: 60000 }).toContain('riquadro incorporato');
});

test('riquadro con script più in basso della prima schermata: tradotto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(INNER('ZZLOW')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, pagina(`<div style="height:2500px"></div><iframe id="emb" src="${src}" style="width:520px;height:220px"></iframe>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.frameLocator('#emb').locator('#fbody')).toHaveText(/^IT /, { timeout: 60000 });
  const t = await esito(page);
  expect(t).not.toContain('riquadro incorporato');
});

test('riquadro con script dentro una sezione ripiegata: non si paga, e si traduce quando la si apre', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(INNER('ZZFOLD')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, pagina(`<details id="d"><summary id="s">Show the comments</summary>
    <div id="dtext">ZZDTEXT plain text inside the folded section, long enough to count.</div>
    <iframe id="emb" src="${src}" style="width:520px;height:220px"></iframe></details>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  const t = await esito(page);
  expect(t).not.toContain('riquadro incorporato');
  await page.waitForTimeout(3000);
  const s = await sent(app);
  expect(s, 'testo normale della sezione ripiegata spedito').not.toContain('ZZDTEXT');
  expect(s, 'riquadro dentro la sezione ripiegata spedito al modello').not.toContain('ZZFOLD');

  // Aperta la sezione, il tasto destro offre di tradurre il testo scoperto, riquadro compreso.
  await page.evaluate(() => { document.getElementById('d').open = true; });
  await page.waitForTimeout(200);
  await page.locator('#p1').click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toHaveAttribute('aria-label', 'Traduci il testo nuovo');
  await btn.click();
  await expect(page.locator('#dtext')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.frameLocator('#emb').locator('#fbody')).toHaveText(/^IT /, { timeout: 60000 });
});

test('riquadro con script trasparente: non si paga', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(INNER('ZZFADE')).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, pagina(`<iframe id="emb" src="${src}" style="opacity:0;width:300px;height:250px"></iframe>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  const t = await esito(page);
  expect(t).not.toContain('riquadro incorporato');
  await page.waitForTimeout(3000);
  expect(await sent(app)).not.toContain('ZZFADE');
});

test('riquadro chiuso a chiave dentro una sezione ripiegata: nessun avviso a vuoto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await stubTranslationProvider(app);
  const src = testServer.html(INNER('ZZLOCK'));
  const page = await testServer.openReady(openTab, pagina(`<details id="d"><summary id="s">Show the box</summary>
    <iframe id="emb" sandbox src="${src}" style="width:520px;height:220px"></iframe></details>`));
  await watchToasts(page);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /, { timeout: 30000 });
  await page.waitForTimeout(4000);
  const t = await toasts(page);
  expect(t).not.toContain('riquadro incorporato');
  expect(t).toContain('Pagina tradotta');
});

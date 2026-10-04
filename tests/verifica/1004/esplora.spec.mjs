import { test, expect } from '../../fixtures/electron.mjs';

test('stesso sito, seconda pagina senza password: resta delicata', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'test-key', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
    });
    globalThis.__mandato = [];
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => { globalThis.__mandato.push(texts.join('\n')); return { vectors: texts.map(() => [0.5, 0.2, 0.9, 0.1]) }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages }) => { globalThis.__mandato.push(JSON.stringify(messages)); return { text: 'R.', provider: 'openrouter', model: 'stub', usage: {} }; };
  });
  const mov = testServer.html('<!doctype html><title>Movimenti</title><body><p>Movimenti: pagato 300 euro a Clinica Verdi</p></body>', { pubblico: true });
  const login = await testServer.openReady(openTab,
    `<!doctype html><title>Accedi</title><body><button id="b">Accedi</button><div id="m"></div><a id="via" href="${mov}">mov</a>`
    + `<script>document.getElementById('b').onclick=()=>{document.getElementById('m').innerHTML='<input placeholder="Password" type="text">';}</script></body>`,
    { pubblico: true });
  await login.click('#b');
  await login.click('#m input');
  await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('sito-pubblico.test')), { timeout: 8_000 }).toBe(true);
  await login.click('#via');
  await login.waitForTimeout(1500);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate(async (i) => window.filoShell.tabs.close(i), id);
  await expect.poll(() => app.evaluate(async () => {
    const e = (await globalThis.SN_ARCHIVED_TABS.list()).find((x) => x.title === 'Movimenti');
    return e ? e.delicata || 'no' : null;
  }), { timeout: 8_000 }).toBe('campi');
  await new Promise((r) => setTimeout(r, 1500));
  const partito = await app.evaluate(() => globalThis.__mandato.slice());
  expect(partito.some((t) => t.includes('Clinica Verdi'))).toBe(false);
});

test('aspetto: Sicurezza e Preferenze, chiaro e scuro', async ({ app, openTab }) => {
  for (const tema of ['light', 'dark']) {
    await app.evaluate((_e, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    const s = await openTab('filo://security/security.html');
    await s.locator('#sec-delicate').scrollIntoViewIfNeeded();
    await s.locator('#sec-delicate-sites').fill('studiorossi.it\nstudio rossi');
    await s.locator('#sec-delicate-sites').blur();
    await s.waitForTimeout(500);
    await s.screenshot({ path: `tests/.shots/v1004-sicurezza-${tema}.png` });
    const p = await openTab('filo://preferences/preferences.html');
    await p.locator('#riassuntoSchede').scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    await p.screenshot({ path: `tests/.shots/v1004-preferenze-${tema}.png` });
  }
});

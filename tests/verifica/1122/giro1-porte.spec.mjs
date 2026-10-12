// #1122 giro 1 — porte vicine provate e chiuse: al tasto destro su una pagina con Trusted Types.

import { test, expect } from '../../fixtures/electron.mjs';

const TT = "require-trusted-types-for 'script'; trusted-types goog#html";
const PAG = (titolo) => `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>${titolo}</h1>
  <p id="paragraph">Usa il tuo account per continuare: una frase da selezionare e spiegare.</p>
  <input id="email" type="email" value="mario.rossi@example.com" style="width:300px">
  <a id="avanti" href="__AVANTI__">Avanti</a>
</body></html>`;

async function pronto(page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 10000 });
}
async function vediMenu(page) {
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  expect(await menu.locator('svg').count()).toBeGreaterThan(3);
  return menu;
}

test('campo email della pagina di accesso: il tasto destro apre il menu', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html(PAG('Accedi'), { headers: { 'Content-Security-Policy': TT } }));
  await pronto(page);
  await page.locator('#email').click({ button: 'right' });
  const menu = await vediMenu(page);
  await expect(menu.getByText('Incolla', { exact: true })).toBeVisible();
});

test('navigazione nella stessa scheda da una pagina TT a un altra TT: il menu si apre ancora', async ({ openTab, testServer }) => {
  const seconda = testServer.html(PAG('Password').replace('__AVANTI__', '#'), { headers: { 'Content-Security-Policy': TT } });
  const page = await openTab(testServer.html(PAG('Accedi').replace('__AVANTI__', seconda), { headers: { 'Content-Security-Policy': TT } }));
  await pronto(page);
  await page.locator('#avanti').click();
  await page.waitForURL(seconda);
  await pronto(page);
  await page.locator('#paragraph').click({ button: 'right' });
  await vediMenu(page);
});

test('Trusted Types dichiarato con un meta: il menu si apre', async ({ openTab, testServer }) => {
  const html = PAG('Meta').replace('<body', `<head><meta http-equiv="Content-Security-Policy" content="${TT}"></head><body`);
  const page = await openTab(testServer.html(html));
  await pronto(page);
  await page.locator('#paragraph').click({ button: 'right' });
  await vediMenu(page);
});

test('pagina che crea riquadri di continuo: il menu e la spiegazione si aprono', async ({ app, openTab, testServer }) => {
  const html = PAG('Riquadri').replace('</body>', `<script nonce="x">setInterval(() => { const f = document.createElement('iframe'); f.style.display='none'; document.body.append(f); f.contentWindow.document.body.textContent = 'x'; if (document.querySelectorAll('iframe').length > 40) document.querySelector('iframe').remove(); }, 50);</script></body>`);
  const page = await openTab(testServer.html(html, { headers: { 'Content-Security-Policy': TT + "; script-src 'nonce-x'" } }));
  await pronto(page);
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(170);
    await page.locator('#paragraph').click({ button: 'right' });
    await vediMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0);
  }
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const models = {};
    for (const a of Object.values(C.ACTIONS)) models[a] = 'deepseek-flash';
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const pezzi = ['Un **account** è ', 'il tuo profilo.'];
    const finta = async ({ onDelta } = {}) => {
      for (const p of pezzi) { if (onDelta) onDelta(p); await new Promise((r) => setTimeout(r, 120)); }
      return { text: pezzi.join(''), usage: {} };
    };
    globalThis.SN_PROVIDER_OPENROUTER = { ...globalThis.SN_PROVIDER_OPENROUTER, streamComplete: finta, complete: finta };
  });
  await page.evaluate(() => {
    const p = document.getElementById('paragraph');
    const r = document.createRange(); r.setStart(p.firstChild, 11); r.setEnd(p.firstChild, 18);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await page.locator('#paragraph').click({ button: 'right', position: { x: 120, y: 8 } });
  const menu = await vediMenu(page);
  await expect(menu).toContainText('il tuo profilo', { timeout: 10000 });
});

test('popup di accesso con Trusted Types: il tasto destro apre il menu', async ({ app, openTab, testServer }) => {
  const login = `${testServer.html(PAG('Accedi popup').replace('__AVANTI__', '#'), { headers: { 'Content-Security-Policy': TT } })}?client_id=x1122&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  const sito = await testServer.openReady(openTab, `<button id="accedi" onclick='window.open(${JSON.stringify(login)}, "_blank", "width=600,height=600")'>Accedi</button>`);
  await sito.click('#accedi');
  let pop = null;
  await expect.poll(async () => {
    pop = app.windows().find((w) => w.url().includes('client_id=x1122'));
    return !!pop;
  }, { timeout: 10000 }).toBe(true);
  await pronto(pop);
  await pop.locator('#paragraph').click({ button: 'right' });
  await vediMenu(pop);
});


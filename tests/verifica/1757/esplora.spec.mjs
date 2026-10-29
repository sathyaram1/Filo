import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Accedi</h1>
  <p id="paragraph">Usa il tuo account per continuare: una frase da selezionare e spiegare.</p>
  <input id="email" type="text" spellcheck="false" value="mario.rossi@example.com" style="width:300px">
  <a id="link" href="https://example.com/x">collegamento</a>
</body></html>`;

const CASI = {
  nessuna: null,
  tt: "require-trusted-types-for 'script'; trusted-types 'none'",
};

async function dump(page) {
  const m = menuDi(page);
  await expect(m.locator('.sn-menu').first()).toBeVisible();
  const r = await m.valuta(() => [...document.querySelectorAll('.sn-menu:not(.sn-menu-sub) button')].map((b) => ({
    t: b.textContent.trim().slice(0, 30),
    ic: !!b.querySelector('.sn-menu-item-icon'),
    svg: !!b.querySelector('.sn-menu-item-icon svg'),
  })));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return r;
}

for (const [nome, csp] of Object.entries(CASI)) {
  test(`esplora ${nome}`, async ({ openTab, testServer }) => {
    const page = await openTab(testServer.html(HTML, csp ? { headers: { 'Content-Security-Policy': csp } } : {}));
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    const out = {};
    await page.locator('#paragraph').click({ button: 'right' });
    out.frase = await dump(page);
    await page.locator('#paragraph').selectText();
    await page.locator('#paragraph').click({ button: 'right', position: { x: 20, y: 8 } });
    out.selezione = await dump(page);
    await page.locator('#email').click({ button: 'right' });
    out.campo = await dump(page);
    await page.locator('#link').click({ button: 'right' });
    out.link = await dump(page);
    console.log(nome, JSON.stringify(out, null, 1));
  });
}

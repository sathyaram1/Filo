// #2052 giro 1 — caratteri insoliti nell'Incolla di Filo in un commento: il testo resta quello degli appunti.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8"><title>Commento</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
  <mock-composer id="c"></mock-composer>
  <input id="riga" style="display:block;margin-top:10px;width:400px">
  <script>
    class MockComposer extends HTMLElement {
      constructor() {
        super();
        const r = this.attachShadow({ mode: 'open' });
        r.innerHTML = '<textarea id="t" style="display:block;width:760px;height:200px;font:18px monospace"></textarea>';
        this.modello = '';
        this.addEventListener('input', () => { this.modello = r.getElementById('t').value; });
      }
    }
    customElements.define('mock-composer', MockComposer);
  </script>
</body>`;

const casella = (page) => page.locator('#c').locator('textarea');
const appunti = (app, testo) => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);

async function incolla(page, loc) {
  await loc.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-paste-main')).toBeVisible({ timeout: 5000 });
  await menu.locator('.sn-menu-paste-main').click();
}

const CASI = [
  ['spazi non separabili', 'Prix : 12 € ?\nOui !'],
  ['a capo di Windows', 'uno\r\ndue\r\n\r\ntre'],
  ['entità scritte', 'scrivo &amp; e &lt;b&gt; e &nbsp; letterali\nok'],
  ['righe vuote e spazi in testa', '\n\n   rientro\n\n\nfine'],
  ['emoji', 'ciao 😀👍🏽\nfamiglia 👨‍👩‍👧'],
];

for (const [nome, testo] of CASI) {
  test(`Incolla con ${nome}: il campo e il sito hanno il testo degli appunti`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await appunti(app, testo);
    await incolla(page, casella(page));
    const atteso = testo.replace(/\r\n/g, '\n');
    await expect.poll(() => casella(page).inputValue()).toBe(atteso);
    expect(await page.evaluate(() => document.getElementById('c').modello)).toBe(atteso);
  });
}

test('Incolla di più righe in un campo di una riga sola', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { window.__ev = 0; document.getElementById('riga').addEventListener('input', () => { window.__ev++; }); });
  await appunti(app, 'mario\nrossi');
  await incolla(page, page.locator('#riga'));
  // Come lo incollerebbe il browser.
  await expect.poll(() => page.locator('#riga').inputValue()).toMatch(/^mario ?rossi$/);
  expect(await page.evaluate(() => window.__ev)).toBeGreaterThan(0);
});

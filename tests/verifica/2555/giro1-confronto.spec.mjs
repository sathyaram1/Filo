// Verifica #2555 giro 1: le voci del tasto destro prima (main) e dopo (ramo), per vedere che nessuna si perde.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(QUI, '..', '..', '.shots');
mkdirSync(SHOTS, { recursive: true });
const RAMO = /#2555/.test(readFileSync(resolve(QUI, '..', '..', '..', 'src', 'content', 'menuIcons.js'), 'utf8'));
const LATO = RAMO ? 'ramo' : 'main';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Icone</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  <img id="foto" src="${img}" width="160" height="90" alt="foto">
  <p><a id="scheda" href="https://esempio.it/altra"><img id="copertina" src="${img}" width="160" height="90" alt="copertina"></a></p>
  <video id="film" width="240" height="135" style="background:#222"></video>
  <p><input id="campo" value="testo nel campo" style="width:200px"></p>
  <div id="vuoto" style="height:200px"></div>
  </body></html>`;

const leggi = (menu) => menu.valuta(() => {
  const vis = (x) => x.getClientRects().length > 0;
  const out = [];
  for (const m of document.querySelectorAll('.sn-menu')) {
    for (const b of m.querySelectorAll('.sn-menu-row-btn')) if (vis(b)) out.push(`icona: ${b.getAttribute('aria-label') || b.title || ''}`);
    for (const b of m.querySelectorAll('.sn-menu-item:not(.sn-menu-row-btn)')) if (vis(b)) out.push(`testo: ${b.textContent.trim().replace(/\s+/g, ' ')}`);
  }
  return out;
});

test(`voci del tasto destro (${LATO})`, async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);
  const risultato = {};
  const casi = [
    ['link', async () => page.locator('#vai').click({ button: 'right' })],
    ['immagine', async () => page.locator('#foto').click({ button: 'right' })],
    ['immagine-link', async () => page.locator('#copertina').click({ button: 'right' })],
    ['filmato', async () => page.locator('#film').click({ button: 'right' })],
    ['campo', async () => page.locator('#campo').click({ button: 'right' })],
    ['pagina', async () => page.locator('#vuoto').click({ button: 'right' })],
    ['testo', async () => {
      await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('testo')); getSelection().removeAllRanges(); getSelection().addRange(r); });
      const t = await page.locator('#testo').boundingBox();
      await page.mouse.click(t.x + 30, t.y + t.height / 2, { button: 'right' });
    }],
  ];
  for (const [nome, apri] of casi) {
    await apri();
    await expect(menu.locator('.sn-menu').first()).toBeVisible();
    await page.waitForTimeout(300);
    const voci = new Set(await leggi(menu));
    const piu = menu.locator('.sn-menu-row-overflow').first();
    if (await piu.count() && await piu.isVisible()) {
      await piu.click();
      await page.waitForTimeout(300);
      for (const x of await leggi(menu)) voci.add(x);
    }
    await page.screenshot({ path: resolve(SHOTS, `v2555-confronto-${LATO}-${nome}.png`) });
    if (RAMO) {
      const conVarianti = await menu.valuta(() => [...document.querySelectorAll('.sn-menu-row-btn[data-sn-varianti="1"]')].map((b) => b.dataset.snVerbo));
      for (const v of conVarianti) {
        await page.keyboard.press('Escape');
        await apri();
        await expect(menu.locator('.sn-menu').first()).toBeVisible();
        let b = menu.locator(`.sn-menu-row-btn[data-sn-verbo="${v}"]`).first();
        if (!(await b.isVisible())) { await menu.locator('.sn-menu-row-overflow').first().click(); b = menu.locator(`.sn-menu-row-btn[data-sn-verbo="${v}"]`).first(); }
        await b.click({ button: 'right' });
        await page.waitForTimeout(300);
        const sub = await menu.valuta(() => [...document.querySelectorAll('.sn-menu-sub .sn-menu-item')].map((x) => x.textContent.trim()));
        for (const s of sub) voci.add(`variante(${v}): ${s}`);
      }
    }
    risultato[nome] = [...voci];
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => getSelection().removeAllRanges());
  }
  writeFileSync(resolve(SHOTS, `verifica-2555-voci-${LATO}.json`), JSON.stringify(risultato, null, 1));
  if (process.env.V2555_OUT) writeFileSync(resolve(process.env.V2555_OUT, `voci-${LATO}.json`), JSON.stringify(risultato, null, 1));
});

// Verifica #725 — il manifesto non deve promettere voci di menu che non esistono,
// e l'avviso su un link sospetto deve essere una frase, non un codice interno.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function capacita() {
  const src = readFileSync(resolve(ROOT, 'src', 'shared', 'capabilities.js'), 'utf8');
  const g = {};
  new Function('globalThis', src).call(g, g);
  return g.SN_CAPABILITIES;
}

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1 id="titolo">Un titolo qualunque da selezionare</h1>
  <p><a id="falso" href="https://paypa1.com/login">Accedi al conto</a></p>
  <p><a id="timestamp" href="https://www.youtube.com/watch?v=abcdefg&t=42">Video al minuto 42</a></p>
  <p><a id="pulito" href="https://esempio-tranquillo.test/articolo">Articolo</a></p>
  <p><a id="conimg" href="https://paypa1.com/login"><img id="img" width="120" height="80"
    src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='80'%3E%3Crect width='120' height='80' fill='%23c66'/%3E%3C/svg%3E"></a></p>
</body></html>`;

async function testiVoci(page) {
  return page.locator('.sn-menu .sn-menu-item').allTextContents();
}

test('clic destro su un link: la spiegazione c’è, la voce "Spiega link" no', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#pulito').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  // Il successo: la sezione con la spiegazione del link è montata da sola.
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  const voci = (await testiVoci(page)).join(' | ');
  expect(voci).not.toMatch(/Spiega link/i);
});

test('clic destro su un’immagine: la descrizione c’è, la voce "Spiega immagine" no', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#img').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="image"]')).toBeVisible();
  const voci = (await testiVoci(page)).join(' | ');
  expect(voci).not.toMatch(/Spiega immagine/i);
});

test('testo selezionato: la spiegazione arriva da sola, senza una voce "Spiegazione"', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.evaluate(() => {
    const el = document.getElementById('titolo');
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#titolo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="text"]')).toBeVisible();
  const voci = (await testiVoci(page)).join(' | ');
  expect(voci).not.toMatch(/^\s*Spiegazione\s*$|\| Spiegazione \|/i);
});

test('il manifesto dice il vero su ogni spiegazione inline', () => {
  const CAP = capacita();
  for (const id of ['explain-link', 'explain-image', 'explain-selection']) {
    const inv = String(CAP.get(id).invoke || '');
    expect(inv, id).toMatch(/da sola|automaticamente/i);
    expect(inv, id).not.toMatch(/(?:tasto destro|clic destro)[^"“«]*?→\s*["“«]/i);
  }
});

test('l’avviso di un link che imita un dominio noto è una frase leggibile', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#falso').click({ button: 'right' });
  const avviso = page.locator('.sn-menu .sn-menu-link-warn');
  await expect(avviso).toBeVisible();
  const t = ((await avviso.textContent()) || '').trim();
  expect(t).not.toMatch(/typosquatting|side_effect|token_in_url|url_invalido|_/);
  expect(t).toMatch(/paypal\.com/);
  await page.screenshot({ path: 'tests/.shots/725-giro1-avviso.png' });
});

test('un link con un normale segnatempo non viene accusato di portare una chiave', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#timestamp').click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(600);
  const n = await page.locator('.sn-menu .sn-menu-link-warn').count();
  const t = n ? ((await page.locator('.sn-menu .sn-menu-link-warn').textContent()) || '') : '';
  expect(t, `avviso su un link YouTube con ?t=42: «${t}»`).not.toMatch(/chiave|al posto tuo/i);
});

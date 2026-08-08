// VERIFIER #405 — "se selezioni del testo lì dentro … non ci sono Copia / Cerca / Leggi".

import { test, expect } from './fixtures/electron.mjs';

const CHILD = `<!doctype html><body style="margin:0;padding:16px">
  <p id="ptext">Parola incorporata univoca zqxwv da copiare e cercare.</p></body>`;
const PARENT = (u) => `<!doctype html><body style="margin:0;padding:20px">
  <p id="outside">Parola nella pagina univoca abcdef da copiare.</p>
  <iframe id="f" src="${u}" width="600" height="240"></iframe></body>`;

async function frameByUrl(page, url) {
  const d = Date.now() + 10000;
  while (Date.now() < d) {
    const f = page.frames().find((x) => x.url() === url && x !== page.mainFrame());
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('frame non trovato');
}

async function selectAndMenu(page, frame, sel) {
  await frame.evaluate((s) => {
    const p = document.querySelector(s);
    const r = document.createRange(); r.selectNodeContents(p);
    const g = window.getSelection(); g.removeAllRanges(); g.addRange(r);
  }, sel);
  await frame.locator(sel).click({ button: 'right' });
  await expect(frame.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  return frame.locator('.sn-menu').first();
}

test('#405 parità delle voci sulla SELEZIONE: riquadro vs pagina', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, PARENT(childUrl));

  const outMenu = await selectAndMenu(page, page.mainFrame(), '#outside');
  const outLabels = await outMenu.evaluate((n) => ({
    testo: n.innerText, aria: [...n.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label')).sort(),
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const fr = await frameByUrl(page, childUrl);
  const inMenu = await selectAndMenu(page, fr, '#ptext');
  const inLabels = await inMenu.evaluate((n) => ({
    testo: n.innerText, aria: [...n.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label')).sort(),
  }));

  console.log('[SEL fuori] aria=' + JSON.stringify(outLabels.aria));
  console.log('[SEL fuori] testo=' + JSON.stringify(outLabels.testo));
  console.log('[SEL dentro] aria=' + JSON.stringify(inLabels.aria));
  console.log('[SEL dentro] testo=' + JSON.stringify(inLabels.testo));

  const mancanti = outLabels.aria.filter((a) => !inLabels.aria.includes(a));
  expect(mancanti, 'azioni sulla selezione presenti fuori ma mancanti dentro il riquadro').toEqual([]);
});

test('#405 "Copia" dalla selezione dentro il riquadro copia davvero', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('---vuoto---'));
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, PARENT(childUrl));
  const fr = await frameByUrl(page, childUrl);
  const menu = await selectAndMenu(page, fr, '#ptext');

  const copyBtn = menu.locator('[aria-label="Copia"], [data-sn-icon-id="copy"]').first();
  await expect(copyBtn, 'nessuna azione Copia nel menu dentro il riquadro').toBeVisible();
  await copyBtn.click();
  await page.waitForTimeout(900);
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  console.log('[COPIA] appunti="' + clip + '"');
  expect(clip, 'Copia dentro il riquadro non ha copiato il testo selezionato').toContain('zqxwv');
});

test('#405 "Cerca" dalla selezione dentro il riquadro apre la ricerca', async ({ app, openTab, testServer, shell }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, PARENT(childUrl));
  const fr = await frameByUrl(page, childUrl);
  const menu = await selectAndMenu(page, fr, '#ptext');

  const searchBtn = menu.locator('[aria-label="Cerca"], [data-sn-icon-id="search"]').first();
  await expect(searchBtn, 'nessuna azione Cerca nel menu dentro il riquadro').toBeVisible();
  await searchBtn.click();
  await page.waitForTimeout(2500);
  const urls = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.url));
  console.log('[CERCA] schede=' + JSON.stringify(urls));
  expect(urls.some((u) => /zqxwv/i.test(u || '')), 'Cerca non ha aperto la ricerca del testo selezionato').toBe(true);
});

test('#405 "Leggi" è disponibile sulla selezione dentro il riquadro', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, PARENT(childUrl));
  const fr = await frameByUrl(page, childUrl);
  const menu = await selectAndMenu(page, fr, '#ptext');
  const read = menu.locator('[aria-label="Leggi"], [data-sn-icon-id="read"], [data-sn-icon-id="speak"]').first();
  const n = await menu.locator('[aria-label="Leggi"], [data-sn-icon-id="read"], [data-sn-icon-id="speak"]').count();
  console.log('[LEGGI] trovate=' + n);
  expect(n, 'nessuna azione Leggi nel menu dentro il riquadro').toBeGreaterThan(0);
  await expect(read).toBeVisible();
});

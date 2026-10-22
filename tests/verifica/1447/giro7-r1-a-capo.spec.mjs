// Giro 7, rilievo 1: nei campi di testo ricco andare a capo non chiude la parola, e l'ultima parola della riga resta
// com'era («Ho visto marco.» e Invio, la firma «marco» e Invio); nella casella di testo semplice invece si corregge.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px sans-serif;border:1px solid #999"></div>
</body>`;
const EDITORI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'editori');
const editore = (nome, avvio) => `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m" contenteditable="true" style="width:700px;border:1px solid #999;min-height:80px"></div>
<script>${fs.readFileSync(path.join(EDITORI, `${nome}.js`), 'utf8')}</script><script>${avvio}(document.getElementById('m'));</script></body>`;

async function apri(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false, automatica: true } });
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}
const testo = (page) => page.locator('#ce').evaluate((el) => el.innerText.replace(/ /g, ' '));

test('r1 nel campo modificabile, a capo dopo «marco.» e dopo la firma «marco» il nome prende la maiuscola', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, PAGINA);
  await page.locator('#ce').click();
  await page.keyboard.type('Ho visto marco.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Saluti,');
  await page.keyboard.press('Enter');
  await page.keyboard.type('marco');
  await page.keyboard.press('Enter');
  await expect.poll(() => testo(page)).toMatch(/^Ho visto Marco\.\n+Saluti,\n+Marco\n*$/);
});

test('r1 nel campo modificabile, a capo con Maiusc+Invio dopo «perchè» la parola si corregge', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, PAGINA);
  await page.locator('#ce').click();
  await page.keyboard.type('Non so perchè');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('ok');
  await expect.poll(() => testo(page)).toMatch(/^Non so perché\n+ok$/);
});

test('r1 nell\'editor ProseMirror, a capo dopo «marco» il nome prende la maiuscola', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, editore('prosemirror', 'avviaPM'));
  await page.locator('#m .ProseMirror').click();
  await page.keyboard.type('Ciao marco');
  await page.keyboard.press('Enter');
  await page.keyboard.type('ok');
  await expect.poll(() => page.evaluate(() => window.pmView.state.doc.textBetween(0, window.pmView.state.doc.content.size, '\n'))).toBe('Ciao Marco\nok');
});

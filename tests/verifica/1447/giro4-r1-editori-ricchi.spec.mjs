// #1447 giro 4 — la correzione automatica negli editor di testo ricco veri (Lexical, ProseMirror), quelli che tengono un
// loro modello del testo, del cursore e dell'annulla. Le librerie stanno impacchettate in editori/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const QUI = path.dirname(fileURLToPath(import.meta.url));
const lexical = fs.readFileSync(path.join(QUI, 'editori', 'lexical.js'), 'utf8');
const prosemirror = fs.readFileSync(path.join(QUI, 'editori', 'prosemirror.js'), 'utf8');

const PAGINA_LEXICAL = `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m" contenteditable="true" style="width:700px;border:1px solid #999;min-height:80px"></div>
<script>${lexical}</script><script>avviaLX(document.getElementById('m'));</script></body>`;
const PAGINA_PM = `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m" style="width:700px;border:1px solid #999;min-height:80px"></div>
<script>${prosemirror}</script><script>avviaPM(document.getElementById('m'));</script></body>`;

async function apri(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

test('r1 nell\'editor Lexical la parola dopo una correzione resta staccata, e l\'annulla riporta la parola com\'era', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, PAGINA_LEXICAL);
  const testo = () => page.evaluate(() => window.lxText());
  await page.locator('#m').click();
  await page.keyboard.type('Ciao marco come va');
  await expect.poll(testo).toBe('Ciao Marco come va');
  await page.keyboard.type(' non so perchè ');
  await expect.poll(testo).toBe('Ciao Marco come va non so perché ');
  await page.keyboard.press('Control+z');
  await expect.poll(testo).toBe('Ciao Marco come va non so perchè ');
});

test('r1 nell\'editor ProseMirror l\'annulla subito dopo la correzione riporta la parola com\'era, non la cancella', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, PAGINA_PM);
  const testo = () => page.evaluate(() => window.pmView.state.doc.textContent.replace(/\u00a0/g, ' '));
  await page.locator('#m .ProseMirror').click();
  await page.keyboard.type('Domani vedo marco perchè ');
  await expect.poll(testo).toBe('Domani vedo Marco perché ');
  await page.keyboard.press('Control+z');
  await expect.poll(testo).toBe('Domani vedo Marco perchè ');
  await page.keyboard.type('va bene');
  await expect.poll(testo).toBe('Domani vedo Marco perchè va bene');
});

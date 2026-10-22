// #1447 giro 4 — esplorazione: la correzione e il suo annulla negli editor di testo ricco veri (ProseMirror, Quill).

import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

const DIR = process.env.EDITORI_DIR;
const pm = fs.readFileSync(`${DIR}/pm.bundle.js`, 'utf8');
const quill = fs.readFileSync(`${DIR}/node_modules/quill/dist/quill.min.js`, 'utf8');

const PAGINA_PM = `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m" style="width:700px;border:1px solid #999;min-height:80px"></div>
<script>${pm}</script><script>avviaPM(document.getElementById('m'));</script></body>`;
const PAGINA_Q = `<!doctype html><meta charset="utf-8"><body style="padding:20px;font:22px sans-serif" lang="it">
<div id="m" style="width:700px;min-height:80px"></div>
<script>${quill}</script><script>window.q = new Quill('#m', {});</script></body>`;

async function prepara(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
}
async function pronta(app, page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
}

for (const [nome, html, sel, modello] of [
  ['prosemirror', PAGINA_PM, '#m .ProseMirror', () => window.pmView.state.doc.textContent],
  ['quill', PAGINA_Q, '#m .ql-editor', () => window.q.getText()],
]) {
  test(`${nome}: correzione e annulla`, async ({ app, openTab, testServer }) => {
    await prepara(app);
    const page = await testServer.openReady(openTab, html, { pubblico: true });
    await pronta(app, page);
    await page.locator(sel).click();
    await page.keyboard.type('Domani vedo marco perchè ');
    await page.waitForTimeout(300);
    console.log(nome, 'DOM:', JSON.stringify(await page.locator(sel).innerText()), 'modello:', JSON.stringify(await page.evaluate(modello)));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    console.log(nome, 'dopo annulla DOM:', JSON.stringify(await page.locator(sel).innerText()), 'modello:', JSON.stringify(await page.evaluate(modello)));
    await page.keyboard.type('ok');
    await page.waitForTimeout(300);
    console.log(nome, 'dopo ok:', JSON.stringify(await page.evaluate(modello)));
  });
}

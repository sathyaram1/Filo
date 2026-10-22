import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';
const QUI = path.dirname(fileURLToPath(import.meta.url));
const lexical = fs.readFileSync(path.join(QUI, 'editori', 'lexical.js'), 'utf8');
const prosemirror = fs.readFileSync(path.join(QUI, 'editori', 'prosemirror.js'), 'utf8');
const spia = `<script>window.__log=[];for (const t of ['beforeinput','input']) window.addEventListener(t,(e)=>window.__log.push(t+':'+e.inputType+':'+(e.data||'')+':prev='+e.defaultPrevented+':trusted='+e.isTrusted));</script>`;
const L = `<!doctype html><meta charset="utf-8"><body lang="it">${spia}<div id="m" contenteditable="true" style="width:700px;min-height:80px"></div><script>${lexical}</script><script>avviaLX(document.getElementById('m'));</script></body>`;
const P = `<!doctype html><meta charset="utf-8"><body lang="it">${spia}<div id="m" style="width:700px;min-height:80px"></div><script>${prosemirror}</script><script>avviaPM(document.getElementById('m'));</script></body>`;
for (const [n, html, sel] of [['lx', L, '#m'], ['pm', P, '#m .ProseMirror']]) {
  test(n, async ({ app, openTab, testServer }) => {
    await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: true, spellcheckContext: false }, correttore: { modelloErrori: false, automatica: true } }); });
    const page = await testServer.openReady(openTab, html, { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
    await page.locator(sel).click();
    await page.keyboard.type('ok marco');
    await page.evaluate(() => { window.__log = []; });
    await page.keyboard.type(' ');
    await page.waitForTimeout(200);
    console.log(n, JSON.stringify(await page.evaluate(() => window.__log)));
  });
}

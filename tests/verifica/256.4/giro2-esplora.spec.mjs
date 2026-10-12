// #256.4 giro 2: esplorazione della casella della chat dell'Editor a varie finestre, zoom e temi.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/256.4';
const FRASE = 'riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera';
const LUNGA = 'Puoi rileggere tutto il documento e dirmi quali frasi suonano troppo formali per un invito a cena fra amici, poi proponimi una versione più calda? 😀 <b>grassetto</b> https://esempio.test/un/indirizzo/molto/lungo/senza/spazi/per/vedere/se/si/spezza';

const DIM = [[1920, 1080], [1280, 800], [1024, 640], [960, 600], [900, 520], [800, 500]];

for (const [w, h] of DIM) {
  for (const tema of ['light', 'dark']) {
    test(`${w}x${h} ${tema}`, async ({ app, shell, openTab }) => {
      test.setTimeout(60_000);
      await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]);
      await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
      await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
      const ed = await openTab('filo://editor/editor.html');
      await ed.emulateMedia({ colorScheme: tema });
      await ed.waitForSelector('.ed-module[data-type="switch"]');
      await ed.locator('.ed-switch-icon').nth(1).click();
      const chat = ed.locator('.ed-module[data-type="chat"]');
      await expect(chat.locator('.sn-voce-btn')).toBeVisible();
      const casella = chat.locator('[data-chat="input"]');
      const misura = () => ed.evaluate(() => {
        const mod = document.querySelector('.ed-module[data-type="chat"]');
        const t = mod.querySelector('[data-chat="input"]');
        const r = (el) => el.getBoundingClientRect();
        const s = r(mod.querySelector('[data-chat="send"]')), m = r(mod.querySelector('.sn-voce-btn')), M = r(mod);
        return { sh: t.scrollHeight, ch: t.clientHeight, tw: Math.round(r(t).width), chatW: mod.querySelector('.ed-chat').clientWidth,
          chatH: mod.querySelector('.ed-chat').clientHeight, log: mod.querySelector('[data-chat="log"]').clientHeight,
          sendIn: s.right <= M.right + 0.5 && s.bottom <= M.bottom + 0.5, micIn: m.right <= M.right + 0.5 && m.bottom <= M.bottom + 0.5,
          tIn: r(t).bottom <= M.bottom + 0.5 };
      });
      const out = {};
      out.vuota = await misura();
      await casella.fill(FRASE);
      out.frase = await misura();
      mkdirSync(SHOTS, { recursive: true });
      await chat.screenshot({ path: `${SHOTS}/${w}x${h}-${tema}-frase.png` });
      await casella.fill(LUNGA);
      out.lunga = await misura();
      await chat.screenshot({ path: `${SHOTS}/${w}x${h}-${tema}-lunga.png` });
      console.log(`${w}x${h} ${tema}`, JSON.stringify(out));
      expect(out.vuota.sh).toBeLessThanOrEqual(out.vuota.ch);
      expect(out.frase.sh).toBeLessThanOrEqual(out.frase.ch);
      expect(out.lunga.sendIn && out.lunga.micIn && out.lunga.tIn).toBe(true);
    });
  }
}

for (const z of [1.25, 1.5]) {
  test(`zoom ${z} a 1280x800`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 800); });
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const ed = await openTab('filo://editor/editor.html');
    await ed.waitForSelector('.ed-module[data-type="switch"]');
    await app.evaluate(({ webContents }, z) => {
      for (const wc of webContents.getAllWebContents()) if (wc.getURL().startsWith('filo://editor')) wc.setZoomFactor(z);
    }, z);
    await ed.waitForTimeout(300);
    await ed.locator('.ed-switch-icon').nth(1).click();
    const chat = ed.locator('.ed-module[data-type="chat"]');
    const casella = chat.locator('[data-chat="input"]');
    const m0 = await casella.evaluate((i) => ({ sh: i.scrollHeight, ch: i.clientHeight }));
    await casella.fill(FRASE);
    const m1 = await casella.evaluate((i) => ({ sh: i.scrollHeight, ch: i.clientHeight, w: i.clientWidth }));
    mkdirSync(SHOTS, { recursive: true });
    await chat.screenshot({ path: `${SHOTS}/zoom-${z}.png` });
    console.log('zoom', z, JSON.stringify({ m0, m1 }));
    expect(m0.sh).toBeLessThanOrEqual(m0.ch);
    expect(m1.sh).toBeLessThanOrEqual(m1.ch);
  });
}

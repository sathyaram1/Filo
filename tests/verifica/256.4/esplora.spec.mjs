import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/verifica-256.4';
const FRASE = 'riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera';

const casi = [
  [null, null, 1], [1280, 800, 1], [1200, 750, 1], [1100, 700, 1], [1060, 660, 1], [1024, 640, 1], [1024, 600, 1],
  [960, 600, 1], [900, 520, 1], [800, 500, 1], [1280, 800, 1.5], [1366, 768, 1.25], [1920, 1080, 1.5], [1440, 900, 1],
];

for (const [w, h, z] of casi) {
  test(`esplora ${w}x${h} z${z}`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    if (w) await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const ed = await openTab('filo://editor/editor.html');
    await ed.waitForSelector('.ed-module[data-type="switch"]');
    if (z !== 1) {
      await app.evaluate(({ BrowserWindow }, f) => {
        const win = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
        win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId).view.webContents.setZoomFactor(f);
      }, z);
      await expect.poll(() => ed.evaluate(() => devicePixelRatio)).toBeGreaterThanOrEqual(z - 0.01);
    }
    await ed.locator('.ed-switch-icon').nth(1).click();
    const chat = ed.locator('.ed-module[data-type="chat"]');
    await expect(chat.locator('.sn-voce-btn')).toBeVisible();
    const casella = chat.locator('[data-chat="input"]');
    const misura = () => ed.evaluate(() => {
      const mod = document.querySelector('.ed-module[data-type="chat"]');
      const t = mod.querySelector('[data-chat="input"]');
      const r = (s) => mod.querySelector(s).getBoundingClientRect();
      const M = mod.getBoundingClientRect();
      const T = r('[data-chat="input"]'), S = r('[data-chat="send"]'), V = r('.sn-voce-btn'), L = r('[data-chat="log"]');
      const cs = getComputedStyle(t);
      const c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontSize} ${cs.fontFamily}`;
      const parola = Math.max(...['paragrafo', 'secondo', 'lettera', 'riassumi', 'documento…'].map((p) => c.measureText(p).width));
      const contenuto = t.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return {
        mod: `${Math.round(M.width)}x${Math.round(M.height)}`, txtW: Math.round(T.width), sh: t.scrollHeight, ch: t.clientHeight,
        log: Math.round(L.height), invioDentro: S.bottom <= M.bottom + 0.5 && S.right <= M.right + 0.5,
        micDentro: V.bottom <= M.bottom + 0.5, spezza: parola > contenuto, font: cs.fontFamily,
        sotto: S.top >= T.bottom - 0.5,
      };
    });
    const out = {};
    out.vuota = await misura();
    await casella.fill(FRASE);
    out.frase = await misura();
    mkdirSync(SHOTS, { recursive: true });
    await chat.screenshot({ path: `${SHOTS}/frase-${w}x${h}-z${z}.png` });
    await casella.fill('una richiesta lunga '.repeat(30));
    await ed.waitForTimeout(100);
    out.lunga = await misura();
    console.log(`CASO ${w}x${h} z${z}`, JSON.stringify(out));
  });
}

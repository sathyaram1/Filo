// #256.4 giro 2, rilievo 1: con la chat dell'Editor bassa (finestra piccola) casella e tasti sotto non ci stanno:
// l'invio e il microfono escono tagliati in fondo e la casella scorre già con una frase e mezza.
import { test, expect } from '../../fixtures/electron.mjs';

for (const [w, h] of [[900, 520], [800, 500]]) {
  test(`r1 finestra ${w}x${h}: la richiesta si legge intera e invio e microfono restano dentro la chat`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const ed = await openTab('filo://editor/editor.html');
    await ed.waitForSelector('.ed-module[data-type="switch"]');
    await ed.locator('.ed-switch-icon').nth(1).click();
    const chat = ed.locator('.ed-module[data-type="chat"]');
    await expect(chat.locator('.sn-voce-btn')).toBeVisible();
    await chat.locator('[data-chat="input"]').fill('riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera');
    const m = await ed.evaluate(() => {
      const mod = document.querySelector('.ed-module[data-type="chat"]');
      const t = mod.querySelector('[data-chat="input"]');
      const M = mod.getBoundingClientRect();
      const dentro = (s) => mod.querySelector(s).getBoundingClientRect().bottom <= M.bottom + 0.5;
      return { intera: t.scrollHeight <= t.clientHeight, invio: dentro('[data-chat="send"]'), microfono: dentro('.sn-voce-btn') };
    });
    expect(m).toEqual({ intera: true, invio: true, microfono: true });
  });
}

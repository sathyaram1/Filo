// Verifica #256.4, giro 4: alla finestra di partenza (1280x800) una richiesta di 100-170 caratteri non ci sta accanto ai
// tasti e, coi tasti sotto, manca di un pixel o due righe: la casella resta stretta accanto ai tasti e nasconde fino a
// cinque righe, mentre sotto la richiesta si leggerebbe intera, o quasi.
import { test, expect } from '../../fixtures/electron.mjs';

const RICHIESTA = 'riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera formale, poi correggi gli errori di battitura e proponi un titolo migliore per il documento intero';

for (const [w, h, n, nascostoMax] of [[1280, 800, 114, 2], [1280, 800, 160, 40], [1366, 768, 135, 20]]) {
  test(`r1 a ${w}x${h} una richiesta di ${n} caratteri non resta stretta accanto ai tasti a nascondere righe`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await app.evaluate(({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('filo://shell')).setSize(w, h);
    }, [w, h]);
    const ed = await openTab('filo://editor/editor.html');
    await ed.waitForSelector('.ed-module[data-type="switch"]');
    await ed.locator('.ed-switch-icon').nth(1).click();
    const chat = ed.locator('.ed-module[data-type="chat"]');
    await expect(chat.locator('.sn-voce-btn')).toBeVisible();
    await chat.locator('[data-chat="input"]').fill(RICHIESTA.slice(0, n));
    const stato = () => ed.evaluate((max) => {
      const mod = document.querySelector('.ed-module[data-type="chat"]');
      const t = mod.querySelector('[data-chat="input"]');
      const fondo = mod.getBoundingClientRect().bottom + 0.5;
      const dentro = (s) => mod.querySelector(s).getBoundingClientRect().bottom <= fondo;
      return { finestra: innerWidth, nascostoAlPiu: t.scrollHeight - t.clientHeight <= max, invio: dentro('[data-chat="send"]'), microfono: dentro('.sn-voce-btn') };
    }, nascostoMax);
    await expect.poll(stato, { timeout: 3_000 }).toEqual({ finestra: w, nascostoAlPiu: true, invio: true, microfono: true });
  });
}

// Verifica #256.4, giro 3: con una finestra di 1280 per 720 (o poco più bassa) la chat dell'Editor resta abbastanza
// larga da tenere microfono e invio accanto alla casella, che così va a capo ogni tre parole e scorre già con una
// frase e mezza, pur avendo spazio in altezza per mostrarla intera.
import { test, expect } from '../../fixtures/electron.mjs';

const FRASE = 'riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera';

for (const [w, h] of [[1280, 720], [1280, 690]]) {
  test(`r1 a ${w}x${h} la richiesta di una frase e mezza si legge intera e i tasti restano dentro la chat`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const ed = await openTab('filo://editor/editor.html');
    await ed.waitForSelector('.ed-module[data-type="switch"]');
    await ed.locator('.ed-switch-icon').nth(1).click();
    const chat = ed.locator('.ed-module[data-type="chat"]');
    await expect(chat.locator('.sn-voce-btn')).toBeVisible();
    const casella = chat.locator('[data-chat="input"]');
    await casella.fill(FRASE);
    const stato = () => ed.evaluate(() => {
      const mod = document.querySelector('.ed-module[data-type="chat"]');
      const t = mod.querySelector('[data-chat="input"]');
      const fondo = mod.getBoundingClientRect().bottom + 0.5;
      const dentro = (s) => mod.querySelector(s).getBoundingClientRect().bottom <= fondo;
      return { intera: t.scrollHeight <= t.clientHeight, invio: dentro('[data-chat="send"]'), microfono: dentro('.sn-voce-btn') };
    });
    await expect.poll(stato, { timeout: 3_000 }).toEqual({ intera: true, invio: true, microfono: true });
  });
}

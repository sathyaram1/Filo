// Verifica #708, giro 2 — lo stato d'errore della bacheca si legge in tema
// chiaro e in tema scuro, e le schede vecchie non restano sotto a spacciarsi
// per attuali.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const SHIPPED = {
  _id: 'fb-verifica-708-b',
  name: 'Miglioramento gia in pagina',
  status: 'done',
  resolvedInVersion: '0.2.70',
  seq: 708, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

test('lo stato d\'errore della bacheca si legge in tema chiaro e in tema scuro', async ({ app, openTab }) => {
  const cartella = join(process.cwd(), 'tests', '.shots', 'board-errore-708');
  mkdirSync(cartella, { recursive: true });

  const page = await openTab(URL);
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async ({}, t) => {
      const s = (await globalThis.__filoStorage.get('settings')).settings || {};
      await globalThis.__filoStorage.set({ settings: { ...s, theme: t } });
    }, tema);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () => window.__boardTest && window.SN_FEEDBACK && window.SN_CHAT_ERRORS,
      null,
      { timeout: 15_000 },
    );
    await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-sn-theme'))).toBe(tema);

    // Prima i miglioramenti ci sono davvero, come con la rete.
    await page.evaluate((shipped) => {
      window.__boardTest.setReleasedVersion('0.2.71');
      window.__boardTest.setList(() => Promise.resolve([shipped]));
    }, SHIPPED);
    await page.evaluate(() => window.__boardTest.reload());
    await expect(page.locator('.bd-card')).toHaveCount(1);

    // Poi la rilettura da capo fallisce.
    await page.evaluate(() => {
      window.__boardTest.setList(() => Promise.reject(new TypeError('Failed to fetch')));
    });
    await page.evaluate(() => window.__boardTest.reload());
    await expect(page.locator('#bdError')).toBeVisible();

    // Nessuna scheda vecchia lasciata a schermo sotto l'errore.
    const resti = await page.evaluate(() => {
      const visibili = [...document.querySelectorAll('.bd-card')]
        .filter((c) => c.getBoundingClientRect().height > 0).length;
      const lista = document.getElementById('bdList');
      return { visibili, listaDisplay: getComputedStyle(lista).display };
    });
    expect(resti).toEqual({ visibili: 0, listaDisplay: 'none' });

    // La frase si legge: contrasto vero fra il testo e lo sfondo della pagina.
    const colori = await page.evaluate(() => {
      const p = document.getElementById('bdErrorMsg');
      const leggi = (el) => getComputedStyle(el);
      const lum = (c) => {
        const [r, g, b] = (c.match(/\d+(\.\d+)?/g) || ['0', '0', '0']).slice(0, 3).map(Number);
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const sfondo = leggi(document.body).backgroundColor;
      const a = lum(leggi(p).color); const b = lum(sfondo);
      const contrasto = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      return { contrasto, testo: p.textContent.trim() };
    });
    expect(colori.testo.length).toBeGreaterThan(10);
    expect(colori.contrasto).toBeGreaterThan(4.5);

    await page.screenshot({ path: join(cartella, `board-errore-${tema}.png`), fullPage: true });
  }
});

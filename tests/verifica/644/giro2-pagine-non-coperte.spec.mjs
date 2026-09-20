// Verifica #644, giro 2 — le pagine potate che il giro 1 non aveva aperto, e
// nei due temi.
//
// Un commento CSS chiuso male mangia la regola che segue: il browser non dà
// errore, la pagina si apre e basta. Qui si guarda che ogni foglio arrivi con
// regole dentro, che niente trabocchi in orizzontale e che il tema vesta la
// pagina sia chiaro sia scuro.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINE = [
  'filo://manage/manage.html',
  'filo://dashboard/dashboard.html',
  'filo://decks/decks.html',
  'filo://board/board.html',
  'filo://credits/credits.html',
  'filo://credits/owner.html',
  'filo://history/history.html',
  'filo://options/options.html',
  'filo://admin-defaults/admin-defaults.html',
  'filo://redteam/redteam.html',
  'filo://error/error.html',
];

for (const url of PAGINE) {
  const nome = url.replace('filo://', '').replace(/[/.]/g, '-');
  test(`si apre, ha regole e regge i due temi: ${url}`, async ({ openTab }) => {
    const page = await openTab(url);
    const errori = [];
    page.on('pageerror', (e) => errori.push(String(e)));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(900);

    for (const tema of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
      await page.waitForTimeout(200);
      const stato = await page.evaluate(() => {
        const fogli = [...document.styleSheets].map((s) => {
          let n = -1;
          try { n = s.cssRules.length; } catch (_) { n = -2; }
          return { href: s.href || '(incorporato)', regole: n };
        });
        const d = document.documentElement;
        return {
          quanti: fogli.length,
          vuoti: fogli.filter((f) => f.regole === 0).map((f) => f.href),
          trabocca: d.scrollWidth - d.clientWidth > 2,
          sfondo: getComputedStyle(document.body).backgroundColor,
          testo: getComputedStyle(document.body).color,
        };
      });
      await page.screenshot({ path: `tests/.shots/verifica-644-g2-${nome}-${tema}.png` }).catch(() => {});

      expect(stato.quanti, `${url} (${tema}): nessun foglio di stile`).toBeGreaterThan(0);
      expect(stato.vuoti, `${url} (${tema}): un foglio è arrivato senza regole dentro`).toEqual([]);
      expect(stato.trabocca, `${url} (${tema}): la pagina trabocca in orizzontale`).toBe(false);
      expect(stato.sfondo, `${url} (${tema}): il corpo è rimasto senza sfondo`).not.toBe('rgba(0, 0, 0, 0)');
      expect(stato.testo, `${url} (${tema}): il testo è rimasto senza colore`).not.toBe('');
    }

    expect(errori, `${url}: la pagina ha sollevato un errore`).toEqual([]);
  });
}

// La shell non è una scheda: il suo foglio si guarda dalla finestra stessa, ed
// è quello potato di più, quindi la cattura serve a guardarla davvero.
test('la shell della finestra ha ancora il suo foglio di stile', async ({ shell }) => {
  await shell.screenshot({ path: 'tests/.shots/verifica-644-g2-shell.png' }).catch(() => {});
  const stato = await shell.evaluate(() => {
    const fogli = [...document.styleSheets].map((s) => {
      let n = -1;
      try { n = s.cssRules.length; } catch (_) { n = -2; }
      return { href: s.href || '(incorporato)', regole: n };
    });
    return { quanti: fogli.length, vuoti: fogli.filter((f) => f.regole === 0).map((f) => f.href) };
  });
  expect(stato.quanti, 'la shell non ha nemmeno un foglio di stile').toBeGreaterThan(0);
  expect(stato.vuoti, 'un foglio della shell è arrivato senza regole dentro').toEqual([]);
});

// Verifica #515 — giro 4.
//
// Il giro 3 ha reso cliccabili le sezioni non ancora scritte: chi le tocca
// adesso legge che non ci sono, invece di restare sul documento di prima. Qui
// si guarda cosa succede DOPO quel clic (si esce da lì? si arriva alle altre?)
// e se quelle voci si vedono abbastanza da venire cliccate.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://transparency/transparency.html';

async function aree(app) {
  return app.evaluate(() => {
    const T = globalThis.SN_TRANSPARENCY;
    const scritti = T.ids();
    return {
      mancanti: T.NAV.filter((n) => !scritti.includes(n.id)).map((n) => ({ id: n.id, label: n.label })),
      scritti,
    };
  });
}

test('dalla sezione non scritta si arriva alle altre e al documento che c\'è', async ({ app, openTab }) => {
  const { mancanti, scritti } = await aree(app);
  expect(mancanti.length, 'tutte le aree hanno un documento: qui non c\'è niente da provare').toBeGreaterThan(1);

  const page = await openTab(`${PAGINA}?doc=${mancanti[0].id}`);
  await expect(page.locator('#subtitle')).toContainText('non è ancora scritta');

  // Dalla pagina di una sezione vuota si deve poter passare a un'altra sezione
  // vuota: se la barra funzionasse solo dal documento, ogni vicolo ne aprirebbe
  // un altro.
  await page.locator(`#nav a[href*="doc=${mancanti[1].id}"]`).click();
  await expect(page.locator('#title')).toHaveText(mancanti[1].label);
  await expect(page.locator('#subtitle')).toContainText('non è ancora scritta');

  // E da lì si arriva a quello che è scritto davvero, con il suo contenuto.
  await page.locator(`#nav a[href*="doc=${scritti[0]}"]`).click();
  await expect(page.locator('#subtitle')).not.toContainText('non è ancora scritta');
  const parole = await page.locator('#doc-body').evaluate((el) => (el.textContent || '').trim().length);
  expect(parole, 'il documento arriva vuoto').toBeGreaterThan(500);
});

// Una voce che porta a una pagina vera va vista: se si legge meno di un'ombra,
// la strada che il giro 3 ha aperto non la imbocca nessuno.
for (const tema of ['light', 'dark']) {
  test(`le sezioni in arrivo si leggono sul tema ${tema}`, async ({ app, openTab }) => {
    const { mancanti } = await aree(app);
    expect(mancanti.length).toBeGreaterThan(0);

    const page = await openTab(PAGINA);
    await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/515-giro4-barra-${tema}.png` }).catch(() => {});

    const misura = await page.evaluate(() => {
      function lum(rgb) {
        const c = rgb.map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      }
      function rgb(str) {
        const m = String(str).match(/rgba?\(([^)]+)\)/);
        return m ? m[1].split(',').slice(0, 3).map((n) => parseFloat(n)) : [0, 0, 0];
      }
      const voce = document.querySelector('#nav .is-soon');
      const st = getComputedStyle(voce);
      const alpha = parseFloat(st.opacity);
      const sfondo = rgb(getComputedStyle(document.body).backgroundColor).some((v) => v > 0)
        ? rgb(getComputedStyle(document.body).backgroundColor)
        : rgb(getComputedStyle(document.documentElement).backgroundColor);
      const testo = rgb(st.color);
      // L'opacità dell'elemento fonde il testo con lo sfondo sotto.
      const visto = testo.map((v, i) => sfondo[i] + alpha * (v - sfondo[i]));
      const a = lum(visto); const b = lum(sfondo);
      const alto = Math.max(a, b); const basso = Math.min(a, b);
      return Math.round(((alto + 0.05) / (basso + 0.05)) * 100) / 100;
    });

    // 3:1 è il minimo perché un elemento di interfaccia si distingua; il testo
    // normale ne vuole 4,5.
    expect(contrasto, `la voce "in arrivo" ha un contrasto di ${contrasto}:1 sul tema ${tema}`)
      .toBeGreaterThanOrEqual(3);
  });
}

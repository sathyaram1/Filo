// Verifica #602, giro 1 — la lamentela riprodotta dove la incontra l'utente.
//
// IL SINTOMO: se Filo non riesce a cifrare uno screenshot (chiave non caricata,
// operazione andata storta) l'allegato partiva LO STESSO, in chiaro, con una
// riga nella console che non legge nessuno. Il deposito si apre col codice di
// scarico che sta nel collegamento, e quel collegamento gira.
//
// Qui la prova sta sul cammino VERO di chi segnala: il riquadro che si apre
// dentro una pagina qualunque. Si toglie a Filo la chiave con cui cifra — come
// in una copia messa male — e si guarda cosa succede premendo «Invia»:
//   · non parte niente (nessun allegato nel deposito, nessuna segnalazione);
//   · il riquadro resta aperto con quello che l'utente aveva scritto;
//   · si legge una frase che dice che non è partito niente, e perché.
//
// Senza il fix è ROSSA: il riquadro si chiude dicendo «Grazie! Feedback
// inviato», e lo screenshot è nel deposito in chiaro.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 10_000 },
  );
  return win;
}

test('senza cifratura la segnalazione NON parte, e chi manda lo legge', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);

  // La copia di Filo «messa male»: la chiave con cui si cifra non c'è. È lo
  // stato in cui, prima del fix, il ripiego in chiaro scattava in silenzio.
  // In più teniamo il conto di ogni richiesta che esce verso il deposito: la
  // promessa è che non ne parta NESSUNA.
  await app.evaluate(async () => {
    globalThis.__chiaveVera = globalThis.SN_FEEDBACK_PUBKEY;
    globalThis.SN_FEEDBACK_PUBKEY = null;
    globalThis.__versoIlDeposito = [];
    const fetchVero = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('uploadType=media') || u.includes('/documents/feedback')) {
        globalThis.__versoIlDeposito.push(u);
        throw new Error('la prova non lascia uscire niente');
      }
      return fetchVero(url, opts);
    };
  });

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  const testo = 'Il pulsante non risponde, allego la schermata.';
  await page.locator('.sn-fb-text').fill(testo);
  await page.locator('.sn-fb-file').setInputFiles({
    name: 'schermata.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(1);

  await page.locator('.sn-fb-send').click();

  // ① Si legge cosa è mancato, E che non è partito niente.
  const stato = page.locator('.sn-fb-status');
  await expect(stato).toContainText(/non ho mandato niente/i, { timeout: 10_000 });
  await expect(stato).toContainText(/cifrar|cifratura|chiave/i);

  // ② Il riquadro è ancora lì con quello che l'utente aveva scritto: può
  // riprovare senza riscrivere.
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await expect(page.locator('.sn-fb-text')).toHaveValue(testo);
  await expect(page.locator('.sn-fb-send')).toBeEnabled();

  // ③ E soprattutto: nel deposito non è arrivato niente.
  const usciti = await app.evaluate(() => globalThis.__versoIlDeposito.slice());
  expect(usciti, 'con la cifratura indisponibile non deve uscire NIENTE').toEqual([]);

  await app.evaluate(() => { globalThis.SN_FEEDBACK_PUBKEY = globalThis.__chiaveVera; });
});

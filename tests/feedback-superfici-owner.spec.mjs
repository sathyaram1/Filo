// Le superfici dell'owner non mandano gli altri in un vicolo cieco (#583).
//
// La posta delle segnalazioni la legge solo chi le gestisce. Per tutti gli
// altri era comunque annunciata in tre posti — il menu App della home, l'icona
// del menu del tasto destro, il comando /feedback in chat — e portava a una
// pagina con quattro schede vuote, una ricerca, un «Riprova» che non poteva
// riuscire e l'invito ad accedere come amministratore, cosa che accedendo non si
// diventa.
//
// Qui si guarda quello che l'utente ottiene davvero:
//   1. /feedback in chat NON apre più quella pagina a chi non la può leggere, e
//      dice la strada che funziona (mandare un feedback si può sempre);
//   2. chi ci arriva lo stesso — scrivendo l'indirizzo — legge una frase che
//      spiega, non «Errore nel caricamento» e non «controlla la connessione»;
//   3. l'invio di un feedback continua a funzionare.
//
// Senza la correzione (1) è rosso: il comando apre una scheda nuova.

import { test, expect } from './fixtures/electron.mjs';

const HOME = 'filo://newtab/';
const INBOX = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';

test('/feedback da chi non gestisce i feedback: nessuna scheda nuova, e la strada giusta detta a parole', async ({ app, openTab }) => {
  const page = await openTab(HOME);
  await page.waitForLoadState('domcontentloaded');

  const primaSchede = await app.evaluate(async ({ BrowserWindow }) => {
    let n = 0;
    for (const w of BrowserWindow.getAllWindows()) n += (w._filoTabs?.tabs?.length || 0);
    return n;
  });

  const input = page.locator('#dashInput, #input, textarea').first();
  await input.waitFor({ timeout: 15_000 });
  await input.fill('/feedback');
  await input.press('Enter');

  // Filo risponde in chat, e dice come si manda un feedback.
  await expect(page.locator('body')).toContainText(/Invia feedback/i, { timeout: 15_000 });
  await expect(page.locator('body')).toContainText(/gestisce/i);

  // E nessuna scheda si è aperta sulla posta dell'owner.
  const dopo = await app.evaluate(async ({ BrowserWindow }) => {
    const urls = [];
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) urls.push(String(t.url || ''));
    }
    return urls;
  });
  expect(dopo.filter((u) => u.includes('feedback/feedback.html'))).toHaveLength(0);
  expect(dopo.length).toBe(primaSchede);
});

test('arrivandoci per indirizzo, la posta spiega invece di dare un errore', async ({ openTab }) => {
  const page = await openTab(INBOX);
  await page.waitForLoadState('domcontentloaded');
  const riquadro = page.locator('#empty');
  await expect(riquadro).toBeVisible({ timeout: 15_000 });
  const testo = (await riquadro.innerText()).toLowerCase();
  expect(testo).toContain('gestisce');
  expect(testo).not.toContain('connessione');
  expect(testo).not.toContain('errore');
});

test('anche Gestione dice che è un permesso che manca, non un guasto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgListEmpty')).toBeVisible({ timeout: 20_000 });
  const testo = (await page.locator('#mgListEmpty').innerText()).toLowerCase();
  expect(testo).toContain('gestisce');
  expect(testo).not.toContain('errore nel caricamento');
});

test('mandare un feedback continua a funzionare per chiunque', async ({ openTab }) => {
  const page = await openTab(HOME);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.filo && window.filo.message);
  const r = await page.evaluate(() => window.filo.message({
    type: 'submit_feedback',
    payload: {
      text: 'Prova di invio dopo la chiusura delle superfici di lettura.',
      url: 'https://esempio.invalid/pagina', title: 'Prova', userAgent: 'spec',
      clientId: 'spec-client', images: [], files: [],
    },
  }));
  expect(r.ok).toBe(true);
});

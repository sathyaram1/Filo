// Chi manda una segnalazione con uno screenshot, riaprendola, trova un
// segnaposto al posto dell'immagine: l'allegato viaggia cifrato con la chiave
// di chi riceve le segnalazioni e lui non lo rivedrà. È voluto. Quello che non
// andava era il messaggio, che gli diceva «Operazione riservata agli
// amministratori» e lo mandava a cercare permessi che non avrà mai.
//
// Trovato nella verifica #582, giro 1.
//
// Pre-condizione che senza il fix fallirebbe: il segnaposto diceva «(immagine
// non disponibile)» e l'hover parlava di amministratori. Qui si asserisce che
// dice invece che l'allegato è partito.
//
// Niente finzioni sul canale: la pagina è aperta da un utente NON amministratore
// e la risposta arriva dal main vero. È l'unico modo di provare le due metà
// insieme (il main che distingue il caso, la pagina che lo scrive).

// Gli altri due casi (trovati nella verifica #582, giro 2) riguardano gli
// allegati che immagini non sono, nella stessa bolla:
//   · l'indirizzo di un allegato lo scrive chi manda la segnalazione, e una
//     segnalazione la manda chiunque senza account: se diventa un collegamento
//     cliccabile, una segnalazione con un finto allegato «schermata.png» che
//     punta al sito di un estraneo è un'esca dentro una pagina di Filo, davanti
//     a ogni tester che apre l'elenco;
//   · il documento che il mittente ha allegato parte cifrato come lo screenshot,
//     quindi il collegamento diretto ai byte gli consegnava un file col nome
//     giusto e il contenuto illeggibile, senza dire niente.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Un allegato del bucket di Filo, nella forma esatta che il modulo dei feedback
// salva nella segnalazione. Non verrà mai scaricato: il main si ferma prima,
// perché chi guarda non è amministratore.
const ALLEGATO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media&token=abc';

test('il mittente vede che il suo screenshot è partito, non un errore di permessi', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await page.evaluate((url) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'mittente-582',
      status: 'open',
      text: 'il tasto salva non risponde',
      images: [url],
      createdAt: new Date().toISOString(),
    }];
  }, ALLEGATO);

  await page.locator('#refresh').click();

  const segnaposto = page.locator('.fb-img-broken');
  await expect(segnaposto).toHaveText('(allegato inviato)', { timeout: 10_000 });

  // L'hover dice perché, e non manda a cercare permessi di amministratore.
  const motivo = await segnaposto.getAttribute('title');
  expect(motivo).toMatch(/inviat/i);
  expect(motivo).not.toMatch(/amministrat/i);
  expect(motivo).not.toMatch(/riservata/i);
});

const DOCUMENTO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497001_3f2a1b0c-2222-4222-8333-444455556666.pdf?alt=media&token=def';
const ESCA = 'https://sito-di-un-estraneo.invalid/accedi';

/** Mette in elenco una sola segnalazione con l'allegato dato. */
async function elencoCon(page, allegato) {
  await page.evaluate(({ f }) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'allegato-582',
      status: 'open',
      text: 'guarda l’allegato',
      images: [],
      files: [f],
      createdAt: new Date().toISOString(),
    }];
  }, { f: allegato });
  await page.locator('#refresh').click();
  const pillola = page.locator('.fb-file').first();
  await expect(pillola).toBeVisible({ timeout: 10_000 });
  return pillola;
}

test('il documento che il mittente ha allegato dice che è partito, invece di scaricarsi rotto', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const pillola = await elencoCon(page, { url: DOCUMENTO, name: 'registro.pdf', type: 'application/pdf' });

  // Il nome resta quello vero: serve a capire quale allegato è.
  await expect(pillola.locator('.fb-file-name')).toHaveText('registro.pdf');
  // Ma il collegamento non porta ai byte grezzi, che sono il testo cifrato.
  expect(await pillola.getAttribute('href')).not.toMatch(/firebasestorage\.googleapis\.com|storage\.googleapis\.com/);
  // E chi l'ha mandato lo legge senza doverci cliccare sopra.
  await expect(pillola.locator('.fb-file-note')).toHaveText('(inviato)', { timeout: 10_000 });
  expect(await pillola.getAttribute('title')).toMatch(/inviat/i);
});

test('chi riceve le segnalazioni l’allegato lo apre: il clic lo chiede decifrato, col suo tipo', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  // Sessione admin finta lato pagina: qui interessa la strada che prende il
  // clic, non la chiave privata (che vive nel main e nei test non c'è).
  await page.evaluate(() => {
    window.__richieste = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'owner@esempio.invalid' } };
      if (msg && msg.type === 'feedback_decrypt_image') {
        window.__richieste.push({ url: msg.url, mime: msg.mime || '' });
        return { ok: true, dataUrl: 'data:application/pdf;base64,JVBERi0=' };
      }
      return orig(msg);
    };
  });
  await page.locator('#refresh').click();

  const pillola = await elencoCon(page, { url: DOCUMENTO, name: 'registro.pdf', type: 'application/pdf' });
  // Per chi lo può aprire non c'è nessuna nota: l'allegato è suo.
  await expect(pillola.locator('.fb-file-note')).toHaveCount(0);

  await pillola.click();
  await expect.poll(async () => page.evaluate(() => window.__richieste.length), { timeout: 10_000 }).toBeGreaterThan(0);
  const richiesta = await page.evaluate(() => window.__richieste[window.__richieste.length - 1]);
  expect(richiesta.url).toBe(DOCUMENTO);
  expect(richiesta.mime).toBe('application/pdf');
});

test('un «allegato» che punta fuori dal deposito di Filo non porta da nessuna parte', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const pillola = await elencoCon(page, { url: ESCA, name: 'schermata.png', type: 'image/png' });

  // L'indirizzo scritto da chi ha mandato la segnalazione non diventa un href…
  expect(await pillola.getAttribute('href')).not.toContain('sito-di-un-estraneo.invalid');

  // …e nemmeno il clic ci porta: nessuna scheda finisce su quell'indirizzo.
  await pillola.click();
  await page.waitForTimeout(1500);
  const aperte = await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().map((w) => {
    try { return w.getURL(); } catch (_) { return ''; }
  }));
  expect(aperte.join(' '), 'il clic sull’esca ha aperto l’indirizzo di un estraneo').not.toContain('sito-di-un-estraneo');
});

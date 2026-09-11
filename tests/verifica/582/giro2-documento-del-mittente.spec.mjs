// Verifica #582, giro 2 — l'allegato che NON è un'immagine, sullo stesso
// schermo del rilievo del giro 1.
//
// Il giro 1 ha sistemato il segnaposto di chi MANDA una segnalazione: il suo
// screenshot non lo rivedrà (parte cifrato con la chiave di chi riceve le
// segnalazioni) e il segnaposto adesso glielo dice, invece di parlargli di
// permessi di amministratore che non avrà mai.
//
// Accanto a quella griglia di immagini, nella stessa bolla, c'è l'elenco degli
// allegati che immagini non sono (.pdf, .txt, .csv, .json). Quelli partono
// cifrati esattamente come le immagini, ma sono collegamenti DIRETTI ai byte sul
// deposito: chi li apre si porta a casa un file col nome giusto e il contenuto
// illeggibile, e nessuno gli dice perché. È lo stesso difetto del giro 1 —
// stesso schermo, stessa causa, altro tipo di allegato — e il giro 1 l'ha
// chiuso da una parte sola.
//
// Cosa deve restare vero: o l'allegato arriva leggibile, o gli si dice che è
// partito, come già fa l'immagine lì accanto. Un file rotto consegnato in
// silenzio è la cosa che non va bene.
//
// (Provata anche l'altra direzione — l'immagine che chi riceve le segnalazioni
// allega a una RISPOSTA — e lì non c'è niente da correggere: la conversazione
// viaggia cifrata, quindi chi non è amministratore non vede affatto la bolla
// della risposta. Il caso non si presenta e quella prova non è rimasta.)

import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Un allegato vero del deposito di Filo, nella forma che il modulo dei feedback
// salva nella segnalazione: percorso con entropia e lasciapassare di download.
const DOCUMENTO_DEL_MITTENTE = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497001_3f2a1b0c-2222-4222-8333-444455556666.pdf?alt=media&token=def';

test('il documento che il mittente ha allegato non lo lascia con un file rotto in mano', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await page.evaluate((fb) => { window.SN_FEEDBACK.list = async () => [fb]; }, {
    _id: 'documento-582',
    status: 'open',
    text: 'allego il registro degli errori',
    images: [],
    files: [{ url: DOCUMENTO_DEL_MITTENTE, name: 'registro.pdf', type: 'application/pdf' }],
    createdAt: new Date().toISOString(),
  });

  await page.locator('#refresh').click();

  const link = page.locator('.fb-file').first();
  await expect(link).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/582-giro2-documento.png' });

  // Il collegamento non porta più ai byte grezzi: quelli sono il testo cifrato.
  const href = (await link.getAttribute('href')) || '';
  expect(href, 'il collegamento porta ancora ai byte cifrati sul deposito')
    .not.toMatch(/firebasestorage\.googleapis\.com|storage\.googleapis\.com/);

  // E chi l'ha mandato lo legge senza doverci cliccare sopra, come già succede
  // per lo screenshot nella stessa bolla.
  await expect(link.locator('.fb-file-note')).toHaveText('(inviato)', { timeout: 10_000 });
  const motivo = (await link.getAttribute('title')) || '';
  expect(motivo).toMatch(/inviat/i);
  expect(motivo).not.toMatch(/amministrat/i);
});

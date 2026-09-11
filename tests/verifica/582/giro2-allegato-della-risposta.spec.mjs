// Verifica #582, giro 2 — l'altra direzione dello stesso confine, e l'altro
// tipo di allegato.
//
// Il giro 1 ha sistemato il segnaposto di chi MANDA una segnalazione: il suo
// screenshot non lo rivedrà (parte cifrato con la chiave di chi riceve) e il
// segnaposto adesso glielo dice, invece di parlargli di permessi che non avrà
// mai. La stessa porta però si apre in altri due punti, e lì è rimasta com'era.
//
// 1) L'allegato che viaggia NELL'ALTRO VERSO. Chi riceve le segnalazioni
//    risponde e allega un'immagine — un ritaglio di come dovrebbe essere, la
//    schermata dell'impostazione da cambiare. Quel turno finisce nella
//    conversazione che l'utente riapre dal riquadro delle sue segnalazioni, e
//    quell'immagine è per LUI. Gli allegati di una risposta NON passano dalla
//    cifratura (solo quelli dell'invio lo fanno): si potrebbe mostrare. Oggi
//    l'utente vede un segnaposto, e il segnaposto gli dice che l'allegato
//    «viaggia cifrato con la chiave di chi riceve le segnalazioni» — una frase
//    sbagliata sopra un'immagine che gli avevano mandato apposta.
//
// 2) L'allegato che non è un'immagine. Un DOCUMENTO allegato all'invio
//    (.pdf, .txt, .csv) nel riquadro è un collegamento diretto ai byte sul
//    deposito, cioè al testo cifrato: chi lo apre si ritrova in mano un file
//    rotto e nessuno gli dice perché. È esattamente il caso del giro 1, sullo
//    stesso schermo, con l'altro tipo di allegato.
//
// Le due metà si chiudono con lo stesso gesto: chi non è amministratore chiede
// l'allegato dallo stesso canale, il canale lo scarica (l'indirizzo è già
// ristretto al deposito di Filo) e decide dai byte — se non sono cifrati li
// restituisce, se lo sono dice che l'allegato è partito.

import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// Allegati veri del deposito di Filo, nella forma che il modulo dei feedback
// salva nella segnalazione.
const BASE = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F';
const IMMAGINE_DELLA_RISPOSTA = `${BASE}1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media&token=abc`;
const DOCUMENTO_DEL_MITTENTE = `${BASE}1788891497001_3f2a1b0c-2222-4222-8333-444455556666.pdf?alt=media&token=def`;

test('l’immagine allegata alla RISPOSTA arriva a chi ha segnalato', async ({ openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  const att = `@@filo-attachment ${JSON.stringify({ kind: 'img', url: IMMAGINE_DELLA_RISPOSTA })}`;
  const notes = ['Ecco come si fa, te lo segno nell’immagine.', att].join('\n');

  await page.evaluate((fb) => { window.SN_FEEDBACK.list = async () => [fb]; }, {
    _id: 'risposta-582',
    status: 'done',
    text: 'non trovo l’impostazione del tema',
    images: [],
    notes,
    createdAt: new Date().toISOString(),
  });

  await page.locator('[data-tab="resolved"]').click();
  await page.locator('#refresh').click();

  await expect(page.locator('.fb-imgs img, .fb-img-broken').first()).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/582-giro2-risposta.png', fullPage: false });

  const rotta = page.locator('.fb-img-broken');
  const quante = await rotta.count();
  const motivo = quante ? await rotta.first().getAttribute('title') : '';
  const testo = quante ? await rotta.first().textContent() : '';

  expect(quante, `l’immagine mandata nella risposta non arriva a chi ha segnalato: «${testo}» — ${motivo}`).toBe(0);
});

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

  // Un collegamento che punta ai byte grezzi del deposito scarica il testo
  // cifrato col nome del file vero: si apre e non è niente. O l'allegato arriva
  // leggibile, o gli si dice che è partito — come già fa l'immagine accanto.
  const href = (await link.getAttribute('href')) || '';
  const spiegazione = ((await link.getAttribute('title')) || '') + ' ' + ((await link.textContent()) || '');
  const puntaAiByteGrezzi = /firebasestorage\.googleapis\.com|storage\.googleapis\.com/.test(href);

  expect(
    !puntaAiByteGrezzi || /inviat|cifrat|riceve/i.test(spiegazione),
    `il documento allegato si scarica cifrato e nessuno lo dice: href=${href.slice(0, 80)} — «${spiegazione.trim()}»`,
  ).toBe(true);
});

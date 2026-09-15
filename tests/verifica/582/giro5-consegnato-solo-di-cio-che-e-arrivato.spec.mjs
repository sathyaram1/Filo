// Verifica #582, giro 5 — il residuo della causa dei giri 2, 3 e 4.
//
// Il giro 4 ha messo il controllo dell'indirizzo PRIMA di quello dell'identità:
// davanti a un allegato che punta al sito di un estraneo, Filo non dichiara più
// che è stato consegnato. Il controllo però guarda la FORMA dell'indirizzo, non
// se quell'oggetto sia mai arrivato — e non può fare altrimenti da questo lato,
// perché senza il lasciapassare il deposito risponde «non hai il permesso» sia
// per un file che c'è sia per uno che non c'è.
//
// Resta quindi che basta scrivere un indirizzo NELLA FORMA del deposito di Filo
// — che non richiede di caricare niente, e nemmeno di avere un account — perché
// Filo dichiari, di suo, che quell'allegato è stato consegnato e che viaggia
// cifrato con la chiave di chi riceve le segnalazioni. Non è mai entrato da
// nessuna parte.
//
// La cura non è indovinare se il file esista: è non dire cose che non si sono
// guardate. A chi non riceve le segnalazioni serve sapere una cosa sola — che
// quell'allegato lo apre solo chi riceve le segnalazioni — e quella è vera in
// tutti i casi. «Consegnato» e «viaggia cifrato» no.
//
// Questa prova diventa verde quando Filo smette di dichiarare consegnato, e
// cifrato, un allegato che non ha mai visto.

import { test, expect } from '../../fixtures/electron.mjs';

const RIQUADRO = 'filo://feedback/feedback.html';
// Forma del deposito di Filo, oggetto mai caricato da nessuno.
const MAI_ARRIVATO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497000_00000000-0000-4000-8000-000000000000.pdf?alt=media';

const segnalazioneFinta = (url) => ({
  _id: 'mai-arrivato-582-g5',
  status: 'open',
  seq: 998,
  name: 'Aggiornamento per i tester',
  text: 'in allegato le istruzioni',
  url: 'https://esempio.invalid/x',
  images: [url.replace('.pdf', '.png')],
  files: [{ name: 'istruzioni.pdf', url, type: 'application/pdf' }],
  createdAt: '2026-09-11T10:00:00Z',
});

test('il canale non dichiara consegnato un allegato che non ha mai visto', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  const r = await page.evaluate(async (u) => {
    const invia = (m) => (window.filo?.message ? window.filo.message(m) : new Promise((res) => window.chrome.runtime.sendMessage(m, res)));
    return invia({ type: 'feedback_decrypt_image', url: u, mime: 'application/pdf' });
  }, MAI_ARRIVATO);

  const frase = String((r && r.error) || '');
  expect(frase, `Filo dice di un allegato mai caricato: «${frase}»`).not.toMatch(/consegnat/i);
  expect(frase, `Filo descrive la cifratura di un allegato mai caricato: «${frase}»`).not.toMatch(/cifrat/i);
  // Quello che serve dire, e che è vero in ogni caso, resta detto.
  expect(frase, `la frase non dice più a chi si apre l'allegato: «${frase}»`).toMatch(/segnalazioni/i);
});

test('la pillola di un allegato mai arrivato non si dichiara consegnata', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await page.evaluate(({ u, finta }) => {
    const f = eval(`(${finta})`)(u);
    window.SN_FEEDBACK.list = async () => [f];
  }, { u: MAI_ARRIVATO, finta: segnalazioneFinta.toString() });
  await page.locator('#refresh').click();
  await expect(page.locator('a.fb-file')).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const nota = ((await page.locator('a.fb-file .fb-file-note').first().textContent().catch(() => '')) || '').trim();
  expect(nota, `la pillola di un allegato mai arrivato si dichiara «${nota}»`).not.toMatch(/consegnat/i);
});

test('il segnaposto di uno screenshot mai arrivato non si dichiara consegnato', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await page.evaluate(({ u, finta }) => {
    const f = eval(`(${finta})`)(u);
    window.SN_FEEDBACK.list = async () => [f];
  }, { u: MAI_ARRIVATO, finta: segnalazioneFinta.toString() });
  await page.locator('#refresh').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 10_000 });
  const segnaposto = page.locator('.fb-img-broken').first();
  await expect(segnaposto).toBeVisible({ timeout: 10_000 });
  const scritta = ((await segnaposto.textContent()) || '').trim();
  expect(scritta, `il segnaposto di uno screenshot mai arrivato si dichiara «${scritta}»`).not.toMatch(/consegnat/i);
});

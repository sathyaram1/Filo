// Verifica #582, giro 3 — l'allegato dopo che ci si è fatti riconoscere.
//
// Da questo lavoro un allegato lo apre solo chi riceve le segnalazioni: a
// chiunque altro il riquadro dei feedback mostra un segnaposto che dice che
// l'allegato è partito. Giusto. Il punto è cosa succede a chi quel
// riconoscimento ce l'ha, ma se lo prende DOPO aver aperto il riquadro: nella
// stessa pagina c'è il pulsante «Accedi», ed è lì apposta perché qualcuno lo
// prema.
//
// La risposta negativa viene tenuta da parte per indirizzo, e l'accesso non la
// butta via: dopo il riconoscimento la lista si ridisegna ma gli allegati
// restano segnaposti, e solo riaprire la pagina li fa tornare.
//
// Cosa deve restare vero: chi si fa riconoscere mentre guarda l'elenco vede gli
// allegati, senza dover riaprire niente.

import { test, expect } from '../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';
const ALLEGATO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497002_3f2a1b0c-3333-4222-8333-444455556666.png?alt=media&token=ghi';
// Un pixel PNG: quello che il main restituirebbe dopo aver decifrato.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('chi si fa riconoscere mentre guarda l’elenco vede gli allegati senza riaprire la pagina', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await page.evaluate((url) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'accesso-582',
      status: 'open',
      text: 'ecco lo screenshot',
      images: [url],
      files: [],
      createdAt: new Date().toISOString(),
    }];
  }, ALLEGATO);

  await page.locator('#refresh').click();

  // Prima dell'accesso: il segnaposto, che è il comportamento voluto.
  // La scritta è passata da «(allegato consegnato)» a «(allegato riservato)»
  // nel giro 5, perché di un allegato che non ha aperto Filo non dichiara che
  // sia arrivato. Quello che questa prova guarda non cambia: prima dell'accesso
  // il segnaposto c'è, dopo l'accesso sparisce senza riaprire la pagina.
  await expect(page.locator('.fb-img-broken')).toHaveText('(allegato riservato)', { timeout: 10_000 });

  // Adesso il riconoscimento arriva. Da qui in poi il canale risponde come
  // risponde a chi riceve le segnalazioni: l'allegato decifrato.
  await page.evaluate((pixel) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'owner@esempio.invalid' } };
      if (msg && msg.type === 'feedback_decrypt_image') return { ok: true, dataUrl: pixel };
      return orig(msg);
    };
  }, PIXEL);

  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('feedback')) {
        wc.send('filo:broadcast', { type: 'auth_changed', signedIn: true, isAdmin: true, profile: { email: 'owner@esempio.invalid' } });
      }
    }
  });
  await expect(page.locator('#adminBanner')).toBeHidden({ timeout: 8_000 });

  await page.screenshot({ path: 'tests/.shots/582-giro3-dopo-accesso.png' });

  // L'allegato deve comparire: siamo chi lo può leggere.
  await expect(
    page.locator('.fb-imgs img'),
    'dopo l’accesso l’allegato resta un segnaposto: la risposta negativa di prima è rimasta in memoria e solo riaprire la pagina la toglie',
  ).toHaveAttribute('src', PIXEL, { timeout: 10_000 });
});

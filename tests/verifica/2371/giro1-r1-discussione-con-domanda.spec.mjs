// Verifica #2371 giro 1, rilievo 1: un messaggio di sola discussione che contiene un punto di domanda fa ancora nascere
// una segnalazione, se la risposta dice «non è possibile» o «c'è un problema con».
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { confirmText } from '../../helpers/confirm.mjs';

async function spia(app) {
  await app.evaluate(() => {
    globalThis.__inviate = [];
    globalThis.SN_FEEDBACK.submit = async (voce) => { globalThis.__inviate.push(voce); return { id: 'fb' }; };
  });
}

async function nessunaSegnalazione(app, chat, avvisi) {
  await chat.waitForTimeout(3_000);
  expect(await confirmText(chat), 'una discussione ha fatto nascere una proposta di segnalazione').toBe('');
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' }),
    'una discussione ha fatto partire la segnalazione automatica').toHaveCount(0);
}

test('r1 una domanda d\'opinione, e la risposta dice «al momento non è possibile»: nessuna segnalazione', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await spia(app);
  await modelloFinto(app, [{ text: 'Sì, è una convenzione nata dai limiti dei vecchi schermi. Al momento non è possibile '
    + 'spostarle in Filo, ma è un\'idea interessante da discutere.' }]);
  await chiedi(chat, 'non trovi strano che tutti i browser abbiano le schede in alto?');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'convenzione nata' })).toBeVisible({ timeout: 15_000 });
  await nessunaSegnalazione(app, chat, avvisi);
});

test('r1 una riflessione chiusa da un «no?», e la risposta dice «c\'è un problema con»: nessuna segnalazione', async ({ app, avvisi }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await spia(app);
  await modelloFinto(app, [{ text: 'Hai ragione: ereditare un default è una scelta per omissione. C\'è un problema con le '
    + 'convenzioni: nessuno le rimette in discussione.' }]);
  await chiedi(chat, 'che sia ereditato non significa che non sia una scelta, no? Apple li ha decisi decenni fa');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'scelta per omissione' })).toBeVisible({ timeout: 15_000 });
  await nessunaSegnalazione(app, chat, avvisi);
});

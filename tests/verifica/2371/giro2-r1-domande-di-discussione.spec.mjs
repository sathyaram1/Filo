// Verifica #2371 giro 2, rilievo 1: una domanda di discussione che non sta nell'elenco delle domande di parere
// («perché…?», «come mai…?», «cosa pensi di…?», «sarebbe meglio…?») passa ancora per una richiesta e fa nascere la proposta.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';
import { confirmText } from '../../helpers/confirm.mjs';

const RISPOSTA = 'È una convenzione nata dai limiti dei vecchi schermi e rimasta per inerzia. Al momento non è possibile '
  + 'spostarle in Filo, ma è un\'idea interessante da discutere.';

for (const messaggio of [
  'perché tutti i browser hanno ancora le schede in alto?',
  'come mai nessuno ha mai messo le schede in basso?',
  'cosa pensi delle schede in alto?',
  'immagina un browser con le schede in basso: sarebbe meglio?',
]) {
  test(`r1 «${messaggio}»: una discussione, nessuna segnalazione`, async ({ app, avvisi }) => {
    test.setTimeout(60_000);
    const chat = await home(app);
    await app.evaluate(() => {
      globalThis.__inviate = [];
      globalThis.SN_FEEDBACK.submit = async (voce) => { globalThis.__inviate.push(voce); return { id: 'fb' }; };
    });
    await modelloFinto(app, [{ text: RISPOSTA }]);
    await chiedi(chat, messaggio);
    await expect(chat.locator('.dash-bubble-filo', { hasText: 'convenzione nata' })).toBeVisible({ timeout: 15_000 });
    await chat.waitForTimeout(3_000);
    expect(await confirmText(chat), 'una domanda di discussione ha fatto nascere una proposta di segnalazione').toBe('');
    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show', { hasText: 'segnalato a chi sviluppa Filo' }),
      'una domanda di discussione ha fatto partire la segnalazione automatica').toHaveCount(0);
    expect(await app.evaluate(() => globalThis.__inviate)).toEqual([]);
  });
}

// L'altra direzione dello stesso riconoscimento: una richiesta senza verbo di comando non conta più come richiesta.
for (const messaggio of ['una finestra in incognito per favore', 'voglio una finestra anonima']) {
  test(`r1 «${messaggio}»: una richiesta vera, e la funzione spiegata a mano si segnala`, async ({ app }) => {
    test.setTimeout(60_000);
    const chat = await home(app);
    await app.evaluate(() => {
      globalThis.SN_FEEDBACK.submit = async () => ({ id: 'fb' });
    });
    await modelloFinto(app, [{ text: 'Per aprire una finestra in incognito premi Ctrl+Shift+N oppure clicca l\'icona Nuova finestra '
      + 'incognito nella barra laterale: lì quello che visiti non resta.' }]);
    await chiedi(chat, messaggio);
    await expect.poll(() => confirmText(chat), { timeout: 15_000, message: 'la richiesta non è stata riconosciuta: nessuna proposta' })
      .toContain('Finestra in incognito');
  });
}

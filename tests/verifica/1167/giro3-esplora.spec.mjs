// #1167 giro 3, esplorazione: la risposta scritta insieme a un'azione con esito banale (un promemoria) e niente bottone.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const RISPOSTA = 'Hai pagato 305,40 € di TARI per il 2026, in due rate.';

test('risposta scritta insieme al solo promemoria: arriva nella bolla?', async ({ app }) => {
  test.setTimeout(60_000);
  try {
    await modelloFinto(app, [
      { text: RISPOSTA, toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"TARI"}' }] },
      { text: 'Fatto: il promemoria suona tra 5 minuti.' },
    ]);
    const page = await home(app);
    await chiedi(page, 'quanto ho pagato di tari? e ricordamelo tra 5 minuti');
    const bolla = page.locator('.dash-bubble-filo');
    await expect(bolla.last()).toContainText('Fatto: il promemoria', { timeout: 15_000 });
    const testo = await bolla.evaluate((el) => el.textContent);
    const esito = (await chiamateAlModello(app))[1].find((m) => m.role === 'tool' && m.tool_call_id === 't1');
    console.log('BOLLA:', testo, '\nESITO:', esito && esito.content);
    expect(testo).toContain(RISPOSTA);
  } finally {
    await ripristina(app);
  }
});

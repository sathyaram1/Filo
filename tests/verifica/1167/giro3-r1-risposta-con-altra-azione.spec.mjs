// #1167 giro 3: la risposta scritta insieme a un'azione che non mette bottoni (un promemoria) finisce fra le note, e
// al modello nessuno lo dice: chiude con la frase sul promemoria e la cifra resta sepolta nel blocco delle attività.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiamateAlModello, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const RISPOSTA = 'Hai pagato 305,40 € di TARI per il 2026, in due rate.';

test('r1 risposta scritta insieme al solo promemoria: arriva nella bolla, o il modello sa che deve riscriverla', async ({ app }) => {
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
    // Successo: la cifra è nella bolla, oppure al modello è stato detto che il suo testo sta fra le note.
    expect(testo.includes(RISPOSTA) || /note di lavoro/.test(esito.content)).toBe(true);
  } finally {
    await ripristina(app);
  }
});

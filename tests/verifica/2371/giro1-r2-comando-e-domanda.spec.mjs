// Verifica #2371 giro 1, rilievo 2: un comando secco insieme a una domanda chiude ancora il turno senza risposta quando la
// domanda è detta con «spiegami» o senza punto di domanda.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello } from '../../helpers/chatFinta.mjs';

const chiama = (id, name, args = {}) => ({ toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

for (const messaggio of [
  'metti il tema scuro e spiegami cosa era quel feedback che mi hai proposto',
  'metti il tema scuro. perché mi hai proposto quel feedback',
]) {
  test(`r2 «${messaggio}»: il tema cambia e la domanda ha la sua risposta`, async ({ app }) => {
    test.setTimeout(60_000);
    const chat = await home(app);
    await modelloFinto(app, [
      chiama('t1', 'IMPOSTA_PREFERENZA', { chiave: 'tema', valore: 'scuro' }),
      { text: 'Quella era una segnalazione proposta in automatico, non scritta da me.' },
    ]);
    await chiedi(chat, messaggio);
    await expect.poll(async () => (await app.evaluate(() => globalThis.SN_STORAGE.getSettings())).theme, { timeout: 15_000 }).toBe('dark');
    await expect(chat.locator('.dash-bubble-filo', { hasText: 'proposta in automatico' }),
      'dopo il tema la domanda è rimasta senza risposta').toBeVisible({ timeout: 15_000 });
    expect((await chiamateAlModello(app)).length).toBe(2);
  });
}

// Verifica #536 — giro 1.
//
// LA PORTA: gli avvisi si leggono da qualunque sito.
//
// Il registro degli avvisi fermati è chiuso alle pagine web, e fa bene. La
// lista degli avvisi, che questo lavoro ha appena riempito di roba che nasce
// dalla posta — il testo dell'avviso, il mittente, e la riga «un avviso da X
// aspetta il controllo» — resta invece aperta: un sito qualunque che l'utente
// sta visitando può chiederla e riceverla.
//
// Rosso finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

const dispatch = (app, msg, sender) =>
  app.evaluate((_electron, { msg, sender }) =>
    globalThis.SN_HANDLE_MESSAGE(msg, sender), { msg, sender });

test('un sito qualunque non deve poter leggere gli avvisi nati dalla posta', async ({ app }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const TG = globalThis.SN_TEXT_GUARDIAN;
    TG.configure({ pausaMs: 0, eseguiModello: async () => '{"esito":"passa"}' });
    await TG.proponiNotifica({
      testo: 'Tre mail da Banca Esempio: il rendiconto trimestrale è pronto.',
      kind: 'info', fiducia: 'contaminato', origine: 'una mail di banca@esempio.it',
    });
    TG.configure({ eseguiModello: async () => { throw new Error('giu'); } });
    await TG.proponiNotifica({
      testo: 'Lo stipendio è stato accreditato.',
      kind: 'info', fiducia: 'contaminato', origine: 'una mail di paghe@azienda.it',
    });
  });

  const web = { tab: { id: 7, url: 'http://evil.example/' }, url: 'http://evil.example/' };
  const r = await dispatch(app, { type: 'filo_get_notifications' }, web);
  expect(r, 'una pagina web riceve la lista degli avvisi dell’utente')
    .toMatchObject({ ok: false, error: 'forbidden' });

  // E da una pagina di Filo invece deve funzionare come prima.
  const filo = { tab: { id: 8, url: 'filo://newtab/' }, url: 'filo://newtab/' };
  const ok = await dispatch(app, { type: 'filo_get_notifications' }, filo);
  expect(ok.ok).toBe(true);
  expect(ok.notifications.length).toBe(1);
  expect(ok.pending.length).toBe(1);
});

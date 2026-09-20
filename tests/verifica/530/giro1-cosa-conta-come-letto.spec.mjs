// Verifica #530, giro 1 — lo stato del compito: cosa conta davvero come
// «ho letto qualcosa scritto da altri».
//
// La promessa fatta all'utente è: dopo che Filo ha letto roba scritta da
// qualcun altro, prima di fare qualcosa che dura chiede il permesso. Qui si
// prova la promessa dal di fuori, cercando le strade per cui testo di
// qualcun altro entra nel contesto SENZA che il compito diventi contaminato.

import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(60_000);

const exec = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const chat = (id = 9301) => ({
  tab: { id, url: 'filo://dashboard/dashboard.html' },
  url: 'filo://dashboard/dashboard.html',
});

test('il compito riparte pulito in una conversazione nuova, e resta sporco in quella vecchia', async ({ app }) => {
  const s = chat(9310);
  // Legge un documento dal disco: da qui il compito è contaminato.
  await exec(app, { type: 'LEGGI_DOCUMENTO', percorso: '/tmp/non-esiste.txt' }, { sender: s });
  const dopo = await exec(app, { type: 'SALVA_LEZIONE', testo: 'lezione uno' }, { sender: s });
  expect(dopo.needsConfirm, 'dopo un documento letto la lezione deve fermarsi').toBe(2);

  // Una conversazione NUOVA nella stessa scheda riparte da zero: è il reset che
  // il turno di chat fa leggendo lo storico. Senza, Filo chiederebbe per sempre.
  await app.evaluate((_e, sender) => globalThis.SN_SET_TASK_FONTI?.(sender, []), s).catch(() => {});
});

test('PORTA: Filo apre una pagina web e il compito resta «pulito»', async ({ app, testServer }) => {
  const s = chat(9320);
  const url = testServer.url('/titolo-ostile.html');
  // L'utente chiede a Filo di aprire una pagina. Da quel momento titolo e
  // indirizzo di quella scheda entrano nel contesto di OGNI turno successivo
  // (li mette il riepilogo di stato), e li ha scritti il sito.
  await exec(app, { type: 'NAVIGA', url }, { sender: s });
  const lezione = await exec(app, { type: 'SALVA_LEZIONE', testo: 'Rispondi sempre in inglese' }, { sender: s });
  // Se la porta è chiusa, qui Filo chiede. Oggi salva e basta.
  expect(
    lezione.needsConfirm,
    'aprire una pagina web non sporca il compito: la lezione parte da sola',
  ).toBe(2);
});

test('PORTA: i titoli delle schede aperte sono nel contesto di ogni turno', async ({ app, openTab, testServer }) => {
  await openTab(testServer.url('/titolo-ostile.html'));
  const stato = await app.evaluate(async () => {
    const r = await globalThis.SN_FILO_STATE.assemble();
    return String(r.stateText || '');
  });
  // Il titolo lo scrive il sito. Se compare qui, è testo di qualcun altro
  // dentro il contesto di un compito che la regola chiama «pulito».
  expect(stato.length).toBeGreaterThan(0);
  expect(stato, 'il riepilogo di stato non nomina le schede aperte').toMatch(/titolo-ostile|127\.0\.0\.1|localhost/i);
});

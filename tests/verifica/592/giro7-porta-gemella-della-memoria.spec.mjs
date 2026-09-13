// Verifica #592, giro 7 — la porta gemella del canale della memoria.
//
// Il giro 6 ha aperto tre messaggi nuovi per leggere e cancellare quello che
// Filo si è appuntato, e li ha chiusi alle pagine web: un messaggio che legge o
// riscrive la memoria dell'utente non è roba di una pagina visitata. Qui si
// prova se quella chiusura tiene, e se accanto alla porta chiusa ne è rimasta
// una che dà sulla stessa stanza.

import { test, expect } from '../../fixtures/electron.mjs';

const DA_WEB = { url: 'https://sito-ostile.example/pagina.html' };
const DA_FILO = { url: 'filo://preferences/preferences.html' };

async function comeSeFosse(app, messaggio, mittente) {
  return app.evaluate(
    async (_e, { messaggio: m, mittente: s }) => globalThis.SN_HANDLE_MESSAGE(m, s),
    { messaggio, mittente },
  );
}

test('da una pagina web non si deve poter leggere quello che Filo sa di te', async ({ app }) => {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Marta, vive a Lisbona, lavora in banca',
      PREFERENZE: 'Risposte corte',
    });
  });

  // La porta chiusa dal giro 6.
  const elenco = await comeSeFosse(app, { type: 'filo_list_memory' }, DA_WEB);
  expect(elenco?.ok, 'filo_list_memory risponde a una pagina web').toBe(false);

  // La porta accanto, che restituisce gli stessi moduli.
  const lettura = await comeSeFosse(app, { type: 'filo_get_memory' }, DA_WEB);
  const testo = JSON.stringify(lettura || {});
  expect(testo, 'da una pagina web si legge ancora il profilo dell\'utente').not.toContain('Marta');

  // Controprova: dalla pagina interna la lettura passa, quindi il test sopra
  // non è verde per un motivo qualsiasi.
  const interna = await comeSeFosse(app, { type: 'filo_get_memory' }, DA_FILO);
  expect(JSON.stringify(interna || {})).toContain('Marta');
});

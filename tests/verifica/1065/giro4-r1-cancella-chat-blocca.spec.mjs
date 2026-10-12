// #1065 giro 4, rilievo 1: senza tetto, cancellare una chat ripassa tutta la Cronologia AI per toglierne il testo,
// e con un mese d'uso intenso (circa 25 MB di voci) il processo principale resta fermo per più di un secondo.
import { test, expect } from '../../fixtures/electron.mjs';

const N = 1000;

test('r1 con circa 25 MB di Cronologia AI cancellare una chat non blocca Filo per più di mezzo secondo', async ({ app }) => {
  test.setTimeout(180_000);
  await app.evaluate(async (_e, { n }) => {
    const pagina = 'testo della pagina letta dal modello, con orari, prezzi e indirizzi. '.repeat(250);
    const risposta = 'Questa è la risposta del modello, lunga come quelle vere. '.repeat(20);
    for (let i = 0; i < n; i++) {
      await globalThis.SN_HISTORY.append({
        action: 'filo_chat', provider: 'openrouter', model: 'deepseek/deepseek-v4-pro',
        input: { userMessage: `domanda ${i}`, pageText: pagina, threadMessages: [{ role: 'user', content: `domanda ${i}` }] },
        output: `${risposta} ${i}`, origin: 'https://esempio.test/', costEur: 0.001,
      });
    }
  }, { n: N });

  const { pausaMassima, totale } = await app.evaluate(async () => {
    const C = globalThis.SN_FILO_CHATS;
    const chat = await C.open();
    await C.append(chat.id, [
      { role: 'user', text: 'Mi trovi un treno per Bologna domani mattina, prima delle nove?' },
      { role: 'filo', text: 'Ci sono un regionale alle 7:15 e una Freccia alle 8:05 da Milano Centrale.' },
    ]);
    // La pausa più lunga del processo principale mentre la chat si cancella: è quanto Filo resta fermo per l'utente.
    let pausaMassima = 0;
    let ultimo = performance.now();
    const timer = setInterval(() => {
      const ora = performance.now();
      pausaMassima = Math.max(pausaMassima, ora - ultimo);
      ultimo = ora;
    }, 5);
    const t0 = performance.now();
    await C.remove(chat.id);
    const totale = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 50));
    clearInterval(timer);
    return { pausaMassima, totale };
  });
  expect(pausaMassima, `Filo è rimasto fermo ${Math.round(pausaMassima)} ms (cancellazione: ${Math.round(totale)} ms)`).toBeLessThan(500);
});

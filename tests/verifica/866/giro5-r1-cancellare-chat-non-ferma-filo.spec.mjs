// Verifica #866 giro 5, rilievo 1: con l'elenco delle richieste ai modelli pieno (il suo tetto è 4 MB, lo raggiunge chi
// usa Filo da qualche giorno), cancellare una chat dalla Cronologia non deve fermare Filo per secondi.
import { test, expect } from '../../fixtures/electron.mjs';

test('cancellare una chat con l’elenco delle richieste pieno non blocca Filo', async ({ app }) => {
  test.setTimeout(120_000);
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const sistema = 'Sei Filo, l’assistente del browser. Rispondi in italiano, con frasi brevi, e non inventare nomi di siti o di file. ';
    const items = [];
    for (let i = 0; i < 120; i++) {
      items.push({
        id: 'h' + i, timestamp: new Date().toISOString(), action: 'filo_chat', costEur: 0.001, output: 'risposta ' + i,
        input: [{ role: 'system', content: sistema.repeat(300) }, { role: 'user', content: 'domanda ' + i }],
      });
    }
    await globalThis.chrome.storage.local.set({ [C.STORAGE_KEYS.HISTORY]: items });
    const msgs = [];
    for (let i = 0; i < 30; i++) {
      msgs.push({ role: i % 2 ? 'filo' : 'user', text: (i % 2 ? 'Ecco cosa penso sul punto ' : 'Dimmi qualcosa sul punto ') + i + ' della nostra discussione' });
    }
    await globalThis.SN_FILO_CHATS.append('chat-da-cancellare', msgs);
    await globalThis.SN_FILO_CHATS.close('chat-da-cancellare');

    // Un battito ogni 5 ms: il buco più lungo fra due battiti è quanto Filo è rimasto fermo.
    const t0 = Date.now();
    const buchi = [];
    let ultimo = t0;
    let vivo = true;
    const batti = () => { const n = Date.now(); buchi.push(n - ultimo); ultimo = n; if (vivo) setTimeout(batti, 5); };
    setTimeout(batti, 5);
    await globalThis.SN_FILO_CHATS.remove('chat-da-cancellare');
    await new Promise((res) => setTimeout(res, 50));
    vivo = false;
    const rimasta = await globalThis.SN_FILO_CHATS.get('chat-da-cancellare');
    return { fermo: Math.max(...buchi), rimasta: !!rimasta };
  });
  expect(r.rimasta).toBe(false);
  expect(r.fermo, `Filo è rimasto fermo ${r.fermo} ms`).toBeLessThan(300);
});

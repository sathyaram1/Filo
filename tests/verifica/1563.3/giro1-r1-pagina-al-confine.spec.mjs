// #1563.3 giro 1: una pagina aperta subito prima del primo messaggio rimasto grezzo la legge il pezzo dopo, ma resta
// attaccata alla riga del pezzo prima. Cancellata la pagina, deve uscire la riga che la dice e restare l'altra.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 cancellata la pagina, esce la riga del diario che la dice e resta quella che non l\'ha vista', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_COMPATTAZIONE;
    const CF = globalThis.SN_CONTESTO_FILO;
    const Chats = globalThis.SN_FILO_CHATS;
    const ORA = 60 * 60 * 1000;
    const tetti = { giorni: 3, token: 100000, soglia: 70000, cache: '1h' };
    const iso = (t) => new Date(t).toISOString();
    const componi = (ora) => CF.componi({ chatId: 'confine1', userMessage: null, storia: [], tetti, osserva: () => '', incognito: false, ora });
    const ora = Date.now() - 6 * ORA;
    await Chats.append('confine1', { role: 'user', text: 'ho due gatti, Miso e Pepe', ts: iso(ora - 5 * ORA) });
    await Chats.append('confine1', { role: 'filo', text: 'Che bei nomi.', ts: iso(ora - 5 * ORA + 1000) });
    // L'utente apre la ricetta e poco dopo chiede a Filo: la pagina sta nel preambolo della domanda.
    const visita = await globalThis.SN_IL_FILO.registraVisita({ url: 'https://ricette.example/carbonara', titolo: 'Carbonara al guanciale', ts: iso(ora - 70 * 60000) }, { incognito: false });
    await Chats.append('confine1', { role: 'user', text: 'che si mangia stasera?', ts: iso(ora - 60 * 60000) });
    await componi(ora - 60 * 60000 + 100);
    await Chats.append('confine1', { role: 'filo', text: 'Una carbonara.', ts: iso(ora - 60 * 60000 + 1000) });
    const vero = C._dip.chiama;
    const visti = [];
    C._dip.chiama = async ({ messages }) => {
      const testo = messages[1].content;
      visti.push(testo);
      const righe = [...testo.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
      return JSON.stringify({ ore: [{ testo: /Carbonara/.test(testo) ? 'letta la carbonara' : 'parlato dei gatti', righe }], memorie: [] });
    };
    try {
      await componi(ora);
      await C.compatta({ incognito: false, motivo: 'prova', ora, tetti, forza: true });
      await componi(ora + 5 * ORA);
      await C.compatta({ incognito: false, motivo: 'prova', ora: ora + 5 * ORA, tetti, forza: true });
    } finally { C._dip.chiama = vero; }
    await globalThis.SN_IL_FILO.cancellaVisite([{ ts: visita.ts, url: 'https://ricette.example/carbonara' }], { incognito: false });
    return { lette: visti.filter((v) => /Carbonara/.test(v)).length, sezione: await C.sezione(false) };
  });
  expect(esito.lette, 'il pezzo con la domanda ha letto la pagina').toBe(1);
  expect(esito.sezione).not.toContain('letta la carbonara');
  expect(esito.sezione).toContain('parlato dei gatti');
});

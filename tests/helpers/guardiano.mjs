// Il guardiano degli avvisi (#536) nelle prove che non parlano di lui.
//
// Da quando il testo nato da contenuto esterno passa da un secondo modello,
// una prova che finge il provider si ritrova fra le mani anche la domanda del
// guardiano: se gli risponde col JSON della chat, il controllo non capisce, il
// testo resta in coda e la prova muore lontano dalla sua causa.
//
// `guardiaDiProva(app)` dà al Filo sotto prova un modello per il guardiano e
// installa `globalThis.__guardia(args)` nel main: dentro il proprio finto
// provider si mette una riga sola in cima,
//   const g = globalThis.__guardia?.(args); if (g) return g;
// e la domanda del guardiano riceve la risposta giusta senza che il resto
// della prova cambi.

export async function guardiaDiProva(app, { verdetto = { passa: true, motivo: null } } = {}) {
  await app.evaluate(async (_e, verdetto) => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    const models = { ...(s.models || {}) };
    // Un soprannome che le altre funzioni non usano: il codice rifiuta di far
    // giudicare il testo a chi l'ha scritto, e qui deve poterlo fare.
    models[C.ACTIONS.NOTICE_GUARD] = 'gemma-lite, claude';
    await globalThis.SN_STORAGE.updateSettings({ models });

    globalThis.__guardiaChiamate = 0;
    globalThis.__guardia = (args) => {
      const testa = (args && args.messages && args.messages[0] && args.messages[0].content) || '';
      if (typeof testa !== 'string' || !testa.startsWith('Sei il guardiano')) return null;
      globalThis.__guardiaChiamate++;
      const a = (args.attempts && args.attempts[0]) || {};
      return { text: JSON.stringify(verdetto), model: a.model, provider: a.provider, usage: {} };
    };
  }, verdetto);
}

export function chiamateAllaGuardia(app) {
  return app.evaluate(() => globalThis.__guardiaChiamate || 0);
}

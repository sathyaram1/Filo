// Il guardiano degli avvisi (#536) nei test che non parlano di lui.
//
// Da quando ogni testo nato da contenuto esterno passa da un secondo modello,
// una prova che configura solo il modello della chat ha un Filo MAL
// CONFIGURATO fra le mani: la risposta non compare e la prova muore lontano
// dalla sua causa. Questo helper dà a quel Filo un guardiano che dice di sì.
//
// Si chiama DOPO aver messo i propri finti provider: incarta quello che trova
// e lascia passare al vero stub tutto ciò che non è una domanda del guardiano.

export async function guardianoPermissivo(app, { verdetto = { passa: true, motivo: null } } = {}) {
  await app.evaluate(async (_e, verdetto) => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    const models = { ...(s.models || {}) };
    // Un soprannome che nella catena della chat non c'è: il codice rifiuta di
    // far giudicare il testo a chi l'ha scritto, ed è giusto che lo faccia
    // anche qui.
    models[C.ACTIONS.NOTICE_GUARD] = 'gemma-lite, claude';
    await globalThis.SN_STORAGE.updateSettings({ models });

    const P = globalThis.SN_PROVIDERS;
    const sotto = P.completeWithFallback;
    globalThis.__guardianoChiamate = 0;
    P.completeWithFallback = async (args) => {
      const testa = (args.messages && args.messages[0] && args.messages[0].content) || '';
      if (typeof testa === 'string' && testa.startsWith('Sei il guardiano')) {
        globalThis.__guardianoChiamate++;
        const a = args.attempts || [{}];
        return { text: JSON.stringify(verdetto), model: a[0].model, provider: a[0].provider, usage: {} };
      }
      return sotto(args);
    };
  }, verdetto);
}

export function chiamateAlGuardiano(app) {
  return app.evaluate(() => globalThis.__guardianoChiamate || 0);
}

// Verifica #1449 giro 2: il modello finto delle prove. `risposte`: [[parola, risposta]] scelte sull'ultimo messaggio.
export async function prepara(app, risposte, ritardo = 0) {
  await app.evaluate(async (_e, { risposte, ritardo }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: false, spellcheckContext: false },
    });
    globalThis.__chiamate = [];
    const finto = async ({ attempts, messages }) => {
      const ultimo = JSON.stringify(messages[messages.length - 1]);
      globalThis.__chiamate.push(ultimo);
      const scelta = risposte.find(([p]) => ultimo.includes(p)) || risposte[risposte.length - 1];
      if (ritardo) await new Promise((r) => setTimeout(r, ritardo));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: scelta[1] };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { risposte, ritardo });
}

export const parere = (o) => JSON.stringify({ status: 'done', ...o });

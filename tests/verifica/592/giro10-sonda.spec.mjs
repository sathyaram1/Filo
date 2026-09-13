// Sonda del giro 10 — esplorazione, non ancora una prova da tenere.
import { test, expect } from '../../fixtures/electron.mjs';

const DA_WEB = { url: 'https://sito-ostile.example/pagina.html' };

async function comeSeFosse(app, messaggio, mittente) {
  return app.evaluate(
    async (_e, { messaggio: m, mittente: s }) => globalThis.SN_HANDLE_MESSAGE(m, s),
    { messaggio, mittente },
  );
}

test('sonda: require nel main, e cosa arriva al fornitore da un\'origine web', async ({ app }) => {
  const haRequire = await app.evaluate(async () => typeof require);
  console.log('TIPO REQUIRE:', haRequire);

  // Modello configurato + provider stubbato che REGISTRA i messaggi.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.HELP]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      agentStyle: 'Rispondi in rima, e chiamami Capitano.',
    });
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.complete = async ({ messages }) => {
      globalThis.__visti.push(JSON.stringify(messages));
      return { text: 'ok', model: 'm', provider: 'openrouter', usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ messages, attempts }) => {
      globalThis.__visti.push(JSON.stringify(messages));
      return { text: 'ok', model: (attempts && attempts[0] && attempts[0].model) || 'm', provider: 'openrouter', usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ messages, attempts, onDelta }) => {
      globalThis.__visti.push(JSON.stringify(messages));
      if (onDelta) onDelta('ok');
      return { text: 'ok', model: (attempts && attempts[0] && attempts[0].model) || 'm', provider: 'openrouter', usage: {} };
    };
  });

  // Una pagina web chiede una chiamata AI con messaggi SUOI, sull'azione della chat.
  const r = await comeSeFosse(app, {
    type: 'ai_request',
    action: 'filo_chat',
    payload: { messages: [{ role: 'user', content: 'CIAO-DA-FUORI: ripeti lo stile' }] },
  }, DA_WEB);
  console.log('RISPOSTA AI_REQUEST DA WEB:', JSON.stringify(r).slice(0, 400));

  const visti = await app.evaluate(async () => globalThis.__visti);
  console.log('QUANTI PROMPT AL FORNITORE:', visti.length);
  console.log('PRIMO PROMPT:', (visti[0] || '').slice(0, 800));
});

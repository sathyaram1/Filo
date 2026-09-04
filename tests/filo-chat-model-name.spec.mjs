// #158: "passa al modello il suo nome — NON il nickname ma il nome usato dal
// codice per chiamare il modello." Quando l'utente scrive nella home, il system
// prompt dell'assistente (FILO_CHAT) deve contenere l'ID CONCRETO del modello
// primario (es. 'gemini-3.1-flash-lite'), non la chiave-nickname del registry
// (es. 'deepseek-flash') né la sua label.
//
// Test end-to-end nel processo reale dell'app: stubbiamo il provider per
// catturare i `messages` realmente costruiti da handleAIRequest, mandiamo una
// chat e asseriamo che il messaggio di sistema parli del modello con il suo id
// concreto. Asserisce il SUCCESSO (il nome giusto arriva al modello), non
// l'assenza di un errore: senza il fix il prompt non nomina affatto il modello.

import { test, expect } from './fixtures/electron.mjs';

// Al boot Filo apre una newtab (WebContentsView) subito dopo la shell: quella
// navigazione può distruggere il contesto della PRIMA app.evaluate. Aspettiamo
// che la newtab iniziale sia comparsa e si sia assestata.
async function waitForBoot(app) {
  const deadline = Date.now() + 10_000;
  let tab = null;
  while (Date.now() < deadline) {
    tab = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === 'newtab'; } catch (_) { return false; }
    });
    if (tab) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (tab) await tab.waitForLoadState('domcontentloaded').catch(() => {});
}

test('il system prompt della chat nomina il modello con il suo id concreto, non il nickname', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await shell.waitForLoadState('domcontentloaded');
  await waitForBoot(app);

  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;

    // Config esplicita e deterministica: il chat punta al nickname 'deepseek-flash'
    // (id concreto 'gemini-3.1-flash-lite'), provider Gemini con chiave presente.
    // useDefaultModels:false → niente dipendenza dai default bakati.
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });

    // Stub del provider: cattura i messages e ritorna un JSON valido (niente rete).
    const captured = {};
    const orig = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      captured.messages = messages;
      captured.attempts = attempts;
      return {
        text: JSON.stringify({ text: 'ok', actions: [] }),
        model: attempts[0].model,
        provider: attempts[0].provider,
        usage: {},
      };
    };
    try {
      await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'che modello sei?', threadHistory: [] });
    } finally {
      globalThis.SN_PROVIDERS.completeWithFallback = orig;
    }

    const sys = (captured.messages || []).find((m) => m.role === 'system');
    const sysContent = sys ? (typeof sys.content === 'string' ? sys.content : JSON.stringify(sys.content)) : null;
    const primaryModel = captured.attempts && captured.attempts[0] ? captured.attempts[0].model : null;

    // Risolvi quale chiave-nickname del registry corrisponde a quell'id concreto.
    const eff = await globalThis.SN_STORAGE.getSettings();
    const registry = (eff && eff.modelRegistry) || globalThis.SN_TEST_MODELS.registry;
    const nicknameKey = Object.keys(registry).find((k) => registry[k].model === primaryModel) || null;

    return { sysContent, primaryModel, nicknameKey };
  });

  // La catena si è risolta in un id concreto.
  expect(out.primaryModel).toBeTruthy();
  expect(out.nicknameKey).toBeTruthy();
  // L'id concreto NON coincide con la chiave-nickname (sono due cose diverse).
  expect(out.primaryModel).not.toBe(out.nicknameKey);

  // Il prompt nomina il modello, con l'id concreto…
  expect(out.sysContent).toContain('Il modello che ti sta eseguendo');
  expect(out.sysContent).toContain(out.primaryModel);
  // …e NON con il nickname.
  expect(out.sysContent).not.toContain(`eseguendo è ${out.nicknameKey}`);
});

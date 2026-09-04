import { readFileSync } from 'node:fs';
export function openrouterKey() {
  const env = readFileSync('C:/Users/agenti AI/Desktop/Filo/agent-bench/.env', 'utf8');
  const m = /^OPENROUTER_KEY=(.+)$/m.exec(env);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}
// Configurazione personale nota: chiave vera + registro di prova.
export async function useOwnModels(app, key, overrides = {}) {
  await app.evaluate(async ({}, a) => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: a.key, tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, ...(a.models || {}) },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, ...(a.registry || {}) },
    });
  }, { key, ...overrides });
}

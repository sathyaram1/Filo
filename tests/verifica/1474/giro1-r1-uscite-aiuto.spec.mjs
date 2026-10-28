// #1474 giro 1 — una ricerca dell'Aiuto fermata dalla porta delle uscite (un segreto nella domanda) è un'uscita
// fermata come quelle della chat: deve entrare nei contatori della sicurezza, con regola, tipo e verbo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const f of ['constants', 'messages', 'tasti', 'modelUsage', 'contatoriGiornalieri', 'contatoriSicurezza']) {
  require(`../../../src/shared/${f}.js`);
}

test('r1 la ricerca dell\'Aiuto fermata per un segreto si conta fra le uscite fermate', async () => {
  const contate = [];
  globalThis.SN_CONTATORI_SICUREZZA_MAIN = {
    uscitaFermata: (u, action) => { contate.push(`${u.regola}:${u.tipo}:${action && action.type}`); return true; },
  };
  const handlers = {};
  const MSG = globalThis.SN_MSG.MSG;
  const ctx = {
    MSG,
    controllaUscita: async () => ({ blocca: true, regola: 'custodito', tipo: 'chiave', frase: 'fermata' }),
    azioneDellAiuto() {},
    chatAiutoDi() { return null; },
    getEffectiveSettings: async () => ({ apiKeys: {}, correttore: {} }),
  };
  require('../../../src/main/services/handlers/ai.js')((tipo, fn) => { handlers[tipo] = fn; }, ctx);
  const r = await handlers[MSG.WEB_SEARCH]({ query: 'cerca sk-or-v1-abcdefghijklmnop', parole: [] }, { url: 'https://negozio.example.it/' });
  expect(r.blocked).toBe('segreto');
  expect(contate).toEqual(['custodito:chiave:CERCA_WEB']);
});

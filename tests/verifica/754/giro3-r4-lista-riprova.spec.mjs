// Verifica #754 giro 3, rilievo 4: se il primo scaricamento della lista dei banner fallisce, Filo non riprova
// fino al prossimo avvio o per una settimana. Vale qualunque riprova a tempo entro sei ore; niente Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);

test('rete assente al primo avvio, poi torna: la lista arriva senza riavviare Filo', async () => {
  const prevEnv = { NODE_ENV: process.env.NODE_ENV, FILO_USER_DATA: process.env.FILO_USER_DATA, FILO_SMOKE: process.env.FILO_SMOKE };
  process.env.NODE_ENV = 'production';
  delete process.env.FILO_SMOKE;
  process.env.FILO_USER_DATA = cartellaTemporanea('filo-lista-');
  const adPath = require.resolve('../../../src/main/services/adblock.js');
  const cbPath = require.resolve('../../../src/main/services/cookieBanners.js');
  const prevAd = require.cache[adPath];
  let rete = false;
  require.cache[adPath] = { id: adPath, filename: adPath, loaded: true, exports: { fetchList: async () => (rete ? '###cookie-notice\n##.cookie-bar' : null) } };
  delete require.cache[cbPath];
  const pending = [];
  const oT = global.setTimeout;
  const oI = global.setInterval;
  global.setTimeout = (fn, ms, ...a) => { pending.push({ fn, ms: Number(ms) || 0 }); return oT(() => {}, 0); };
  global.setInterval = (fn, ms, ...a) => { pending.push({ fn, ms: Number(ms) || 0 }); const t = oI(() => {}, 1 << 30); t.unref && t.unref(); return t; };
  try {
    const cb = require(cbPath);
    await cb.init({ security: { cookies: { mode: 'default' } } });
    await new Promise((r) => oT(r, 200));
    expect(cb.forHost('esempio.it').count).toBe(0);
    rete = true;
    // Il tempo passa: partono i promemoria di Filo fissati entro sei ore.
    for (let giro = 0; giro < 20 && cb.forHost('esempio.it').count === 0; giro++) {
      const pronti = pending.splice(0).filter((p) => p.ms <= 6 * 3600 * 1000);
      if (!pronti.length) break;
      for (const p of pronti) { try { await p.fn(); } catch (_) {} }
      await new Promise((r) => oT(r, 50));
    }
    expect(cb.forHost('esempio.it').count).toBeGreaterThan(0);
  } finally {
    global.setTimeout = oT;
    global.setInterval = oI;
    if (prevAd) require.cache[adPath] = prevAd; else delete require.cache[adPath];
    delete require.cache[cbPath];
    for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

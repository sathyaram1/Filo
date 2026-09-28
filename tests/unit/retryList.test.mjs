// Liste scaricate (banner dei cookie, pubblicità): un primo scaricamento fallito si ritenta a tempo,
// senza aspettare il riavvio o la settimana del giro periodico (#754).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVICES = join(ROOT, 'src', 'main', 'services');
const { makeRetry, DELAYS_MS } = require(join(SERVICES, 'retryList.js'));

const flush = () => new Promise((r) => setImmediate(r));

test('un giro fallito si ritenta con attese crescenti, e un giro riuscito azzera', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const esiti = [false, false, true, false];
    let giri = 0;
    const start = makeRetry(() => ({ ok: esiti[giri++] }), () => true);
    await start(); await flush();
    assert.equal(giri, 1);
    mock.timers.tick(DELAYS_MS[0]); await flush(); await flush();
    assert.equal(giri, 2);
    mock.timers.tick(DELAYS_MS[1] - 1); await flush();
    assert.equal(giri, 2, 'la seconda attesa è più lunga della prima');
    mock.timers.tick(1); await flush(); await flush();
    assert.equal(giri, 3);
    await start(); await flush();
    assert.equal(giri, 4);
    mock.timers.tick(DELAYS_MS[0]); await flush(); await flush();
    assert.equal(giri, 5, 'dopo un giro riuscito si riparte dalla prima attesa');
  } finally { mock.timers.reset(); }
});

test('con la lista spenta non si ritenta', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let on = true;
    let giri = 0;
    const start = makeRetry(() => { giri++; return { ok: false }; }, () => on);
    await start(); await flush();
    on = false;
    mock.timers.tick(DELAYS_MS[DELAYS_MS.length - 1]); await flush();
    assert.equal(giri, 1);
  } finally { mock.timers.reset(); }
});

test('lista dei banner: prima apertura senza rete, poi la rete torna e la lista arriva senza riavvio', async () => {
  const env = { NODE_ENV: process.env.NODE_ENV, FILO_USER_DATA: process.env.FILO_USER_DATA, FILO_SMOKE: process.env.FILO_SMOKE };
  process.env.NODE_ENV = 'production';
  delete process.env.FILO_SMOKE;
  process.env.FILO_USER_DATA = cartellaTemporanea('filo-lista-');
  const adPath = require.resolve(join(SERVICES, 'adblock.js'));
  const cbPath = require.resolve(join(SERVICES, 'cookieBanners.js'));
  const prevAd = require.cache[adPath];
  let rete = false;
  require.cache[adPath] = { id: adPath, filename: adPath, loaded: true, exports: { fetchList: async () => (rete ? '###cookie-notice' : null) } };
  delete require.cache[cbPath];
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const CB = require(cbPath);
    await CB.init({ security: { cookies: { mode: 'default' } } });
    for (let i = 0; i < 5; i++) await flush();
    assert.equal(CB.forHost('esempio.it').count, 0);
    rete = true;
    mock.timers.tick(DELAYS_MS[0]);
    for (let i = 0; i < 10; i++) await flush();
    assert.ok(CB.forHost('esempio.it').count > 0);
  } finally {
    mock.timers.reset();
    if (prevAd) require.cache[adPath] = prevAd; else delete require.cache[adPath];
    delete require.cache[cbPath];
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

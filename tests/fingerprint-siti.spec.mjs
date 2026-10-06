// #796 — Lo stesso script di tracciamento su due siti diversi legge due impronte diverse anche sotto un suffisso
// nazionale a due livelli o su due IP; le pagine dello stesso sito ne leggono una sola. Il sito è quello dei cookie.
// I nomi arrivano al server locale con host-resolver-rules: la rete vera non serve.

import { test as base, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOMI = ['shop.com.tw', 'www.shop.com.tw', 'altro.com.tw', 'negozio.co.id', 'toko.co.id', 'tienda.com.co', 'otra.com.co', '192.168.1.10', '10.0.1.10'];

const test = base.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-fp-siti-');
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=${NOMI.map((n) => `MAP ${n} 127.0.0.1`).join(', ')}`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

// Quello che fa uno script di fingerprinting: disegna una scena fissa e ne legge i pixel.
const IMPRONTA = () => {
  const c = document.createElement('canvas');
  c.width = 80; c.height = 40;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1e90ff'; ctx.fillRect(0, 0, 80, 40);
  ctx.fillStyle = '#000'; ctx.font = '16px sans-serif'; ctx.fillText('filo', 4, 24);
  const url = c.toDataURL();
  if (!url.startsWith('data:image/png')) return url;
  // Su http non c'è crypto.subtle: basta un FNV-1a a 32 bit, preso due volte con semi diversi.
  const fnv = (s, h) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
  return [fnv(url, 2166136261), fnv(url, 33554467)].map((h) => h.toString(16).padStart(8, '0')).join('');
};

test('due siti diversi leggono impronte diverse, due pagine dello stesso sito la stessa', async ({ openTab, testServer }) => {
  test.setTimeout(90_000);
  const porta = new URL(testServer.origin).port;
  const impronte = {};
  for (const nome of NOMI) {
    const id = new URL(testServer.html(`<title>FP ${nome}</title><p>${nome}</p>`)).pathname;
    const page = await openTab(`http://${nome}:${porta}${id}`);
    await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 8_000 });
    impronte[nome] = await page.evaluate(IMPRONTA);
    expect(impronte[nome]).toMatch(/^[0-9a-f]{16}$/);
  }
  expect(impronte['www.shop.com.tw']).toBe(impronte['shop.com.tw']);
  expect(impronte['altro.com.tw']).not.toBe(impronte['shop.com.tw']);
  expect(impronte['toko.co.id']).not.toBe(impronte['negozio.co.id']);
  expect(impronte['otra.com.co']).not.toBe(impronte['tienda.com.co']);
  expect(impronte['10.0.1.10']).not.toBe(impronte['192.168.1.10']);
});

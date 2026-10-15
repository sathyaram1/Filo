// #796 giro 3: i suffissi del giro 2 (jolly, tre etichette, nomi non latini) separano; le eccezioni e i sottodomini no.

import { test as base, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOMI = ['uno.com.pg', 'due.com.pg', 'a.chiyoda.tokyo.jp', 'b.chiyoda.tokyo.jp', 'a.lib.ca.us', 'b.lib.ca.us', 'a1.xn--55qx5d.cn', 'b1.xn--55qx5d.cn', 'x.city.kawasaki.jp', 'y.city.kawasaki.jp', 'x.a.sch.uk', 'www.x.a.sch.uk'];

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

test('jolly, tre etichette e nomi non latini separano, eccezioni e sottodomini no', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const porta = new URL(testServer.origin).port;
  const impronte = {};
  for (const nome of NOMI) {
    const id = new URL(testServer.html(`<title>FP ${nome}</title><p>${nome}</p>`)).pathname;
    const page = await openTab(`http://${nome}:${porta}${id}`);
    await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 8_000 });
    impronte[nome] = await page.evaluate(IMPRONTA);
    expect(impronte[nome]).toMatch(/^[0-9a-f]{16}$/);
  }
  for (const [x, y] of [['uno.com.pg', 'due.com.pg'], ['a.chiyoda.tokyo.jp', 'b.chiyoda.tokyo.jp'], ['a.lib.ca.us', 'b.lib.ca.us'], ['a1.xn--55qx5d.cn', 'b1.xn--55qx5d.cn']]) expect(impronte[y], `${x} / ${y}`).not.toBe(impronte[x]);
  expect(impronte['y.city.kawasaki.jp']).toBe(impronte['x.city.kawasaki.jp']);
  expect(impronte['www.x.a.sch.uk']).toBe(impronte['x.a.sch.uk']);
});

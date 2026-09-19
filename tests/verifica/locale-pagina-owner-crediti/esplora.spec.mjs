// Esplorazione (non è una prova: serve a guardare la pagina dell'owner).
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity, APP_ROOT,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo');

test('esplora la pagina dell’owner', async () => {
  test.setTimeout(180_000);
  const server = await avviaServer();
  const filo = await avviaFilo({ env: server.env });
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);

    // Due persone dentro, con del consumo.
    const codes = await server.codiciOwner(3);
    await server.service.redeem('anon-a', codes[0], server.deps);
    await server.service.redeem('anon-b', codes[1], server.deps);
    const pa = server.store.docs.wallets.get('anon-a').pseudonym;
    server.store.docs.usage.push(
      { pseudonym: pa, at: '2026-09-18T10:00:00.000Z', action: 'chat', model: 'glm', servedBy: 'Baseten', promptTokens: 100, completionTokens: 20, costUsd: 0.0031, credits: 4 },
      { pseudonym: pa, at: '2026-09-19T11:00:00.000Z', action: 'traduci', model: 'glm', servedBy: 'Baseten', promptTokens: 30, completionTokens: 8, costUsd: 0.0009, credits: 1 },
    );

    const page = await apriOwner(filo);
    await page.waitForTimeout(3000);
    const dump = await page.evaluate(() => document.querySelector('main').outerHTML);
    mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true });
    writeFileSync(join(APP_ROOT, 'tests', '.shots', 'owner-dump.html'), dump);
    await page.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'owner-esplora.png'), fullPage: true });
    console.log('PSEUDONIMI', pa, server.store.docs.wallets.get('anon-b').pseudonym);
    console.log('CONFIG', JSON.stringify(server.store.docs.config));
  } finally {
    try { await filo.app.close(); } catch (_) {}
    await server.chiudi();
  }
});

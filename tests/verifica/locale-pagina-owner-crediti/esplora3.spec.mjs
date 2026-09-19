// Esplorazione 3 (non è una prova): un numero scritto e non salvato.
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity, APP_ROOT,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo');

test('esplora 3', async () => {
  test.setTimeout(300_000);
  const server = await avviaServer();
  const filo = await avviaFilo({ env: server.env });
  const r = {};
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');

    // Scrivo 500 e NON premo Salva: che cosa dice la pagina?
    await page.fill('#knob-dailyCredits', '500');
    await page.locator('#knob-entryCredits').click(); // il cursore lascia il campo
    await page.waitForTimeout(2500);
    r.dopoAverScritto = {
      campo: await page.inputValue('#knob-dailyCredits'),
      classi: await page.locator('.sn-manopola[data-chiave="dailyCredits"]').getAttribute('class'),
      msg: await page.locator('#knob-dailyCredits-msg').isVisible(),
      config: server.store.docs.config.dailyCredits ?? null,
      quotaInVigore: (await server.configEffettiva()).dailyCredits,
    };

    // Salvo un'ALTRA manopola: il 500 scritto accanto sopravvive?
    await page.fill('#knob-entryCredits', '4000');
    await page.click('#knob-entryCredits-salva');
    await page.waitForTimeout(3000);
    r.dopoAverSalvatoUnAltra = {
      campoDaily: await page.inputValue('#knob-dailyCredits'),
      configDaily: server.store.docs.config.dailyCredits ?? null,
    };

    // Vado via dalla pagina e torno.
    await page.reload();
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 20_000 });
    await page.waitForTimeout(2500);
    r.dopoEsseraTornato = {
      campoDaily: await page.inputValue('#knob-dailyCredits'),
      quotaInVigore: (await server.configEffettiva()).dailyCredits,
    };
  } finally {
    writeFileSync(join(APP_ROOT, 'tests', '.shots', 'owner-esplora3.json'), JSON.stringify(r, null, 2));
    try { await filo.app.close(); } catch (_) {}
    await server.chiudi();
  }
});

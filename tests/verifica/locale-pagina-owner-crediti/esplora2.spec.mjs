// Esplorazione 2 (non è una prova).
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity, APP_ROOT,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo');
const OUT = join(APP_ROOT, 'tests', '.shots', 'owner-esplora2.json');

test('esplora 2', async () => {
  test.setTimeout(300_000);
  const server = await avviaServer();
  const filo = await avviaFilo({ env: server.env });
  const r = {};
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const [code] = await server.codiciOwner(1);
    await server.service.redeem('anon-a', code, server.deps);

    const page = await apriOwner(filo);
    await expect(page.locator('#ownerNumeri')).toContainText('utent', { timeout: 20_000 });
    const numeri = () => page.locator('#ownerNumeri').innerText();
    r.numeriPrima = await numeri();

    // Il tetto cambia: i numeri in cima dipendono da lui.
    await page.fill('#knob-maxGrantCredits', '90000');
    await page.click('#knob-maxGrantCredits-salva');
    await expect(page.locator('#knob-maxGrantCredits-msg')).toContainText('Salvato', { timeout: 20_000 });
    await page.waitForTimeout(3000);
    r.numeriDopoSenzaRicarica = await numeri();
    await page.reload();
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 20_000 });
    await page.waitForTimeout(2500);
    r.numeriDopoRicarica = await numeri();

    // «Rimetti com'era» dopo un salvataggio RIFIUTATO dal server.
    server.flags.fsDenied = true;
    await page.fill('#knob-rewardFeedbackClosed', '99');
    await page.click('#knob-rewardFeedbackClosed-salva');
    await page.waitForTimeout(3000);
    r.salvataggioRifiutato = {
      msg: await page.locator('#knob-rewardFeedbackClosed-msg').innerText().catch(() => ''),
      rimettiVisibile: await page.locator('#knob-rewardFeedbackClosed-rimetti').isVisible(),
      config: server.store.docs.config.rewardFeedbackClosed ?? null,
    };
    if (r.salvataggioRifiutato.rimettiVisibile) {
      server.flags.fsDenied = false;
      await page.click('#knob-rewardFeedbackClosed-rimetti');
      await page.waitForTimeout(3000);
      r.dopoRimettiDaUnRifiuto = {
        campo: await page.inputValue('#knob-rewardFeedbackClosed'),
        msg: await page.locator('#knob-rewardFeedbackClosed-msg').innerText().catch(() => ''),
        config: server.store.docs.config.rewardFeedbackClosed ?? null,
      };
    }
  } finally {
    writeFileSync(OUT, JSON.stringify(r, null, 2));
    try { await filo.app.close(); } catch (_) {}
    await server.chiudi();
  }
});

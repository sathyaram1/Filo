// Esplorazione (non è una prova: serve a guardare la pagina dell'owner).
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity, APP_ROOT,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo');
const OUT = join(APP_ROOT, 'tests', '.shots', 'owner-esplora.json');

test('esplora la pagina dell’owner', async () => {
  test.setTimeout(240_000);
  const server = await avviaServer();
  const filo = await avviaFilo({ env: server.env });
  const rapporto = {};
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);

    const codes = await server.codiciOwner(3);
    await server.service.redeem('anon-a', codes[0], server.deps);

    const page = await apriOwner(filo);
    await page.waitForTimeout(2500);

    const leggi = () => page.evaluate(() => {
      const out = {};
      for (const i of document.querySelectorAll('#ownerKnobs input')) out[i.id.replace('knob-', '')] = i.value;
      return out;
    });
    rapporto.valoriIniziali = await leggi();
    rapporto.configPrima = { ...server.store.docs.config };

    // Cambio «crediti a chi entra» e salvo.
    await page.fill('#knob-entryCredits', '777');
    await page.click('#knob-entryCredits-salva');
    await page.waitForTimeout(3000);
    rapporto.msgSalva = await page.locator('#knob-entryCredits-msg').innerText().catch(() => '');
    rapporto.configDopo = { ...server.store.docs.config };
    rapporto.fs = server.counters.fsCalls.map((c) => [c.method, c.docPath, c.mask.join(',')]);

    // Il server ubbidisce?
    const r = await server.service.redeem('anon-c', codes[1], server.deps);
    rapporto.redeemDopo = { status: r.status, credits: r.credits };

    // Numeri storti.
    rapporto.valoriDopoSalva = await leggi();
    for (const [chiave, valore] of [['dailyCredits', '3.5'], ['dailyCredits', '2000000'], ['invitesMaxUses', '0'], ['maxGrantCredits', '1']]) {
      await page.fill(`#knob-${chiave}`, valore);
      await page.click(`#knob-${chiave}-salva`);
      await page.waitForTimeout(900);
      rapporto[`storto_${chiave}_${JSON.stringify(valore)}`] = {
        msg: await page.locator(`#knob-${chiave}-msg`).innerText().catch(() => ''),
        config: server.store.docs.config[chiave] ?? null,
      };
    }
    rapporto.valoriFinali = await leggi();
    // Il tetto a 1 credito: nessuna strada deve più elargire.
    await page.fill('#knob-maxGrantCredits', '1');
    await page.click('#knob-maxGrantCredits-salva');
    await page.waitForTimeout(2500);
    rapporto.tettoMsg = await page.locator('#knob-maxGrantCredits-msg').innerText().catch(() => '');
    rapporto.tettoConfig = server.store.docs.config.maxGrantCredits ?? null;
    const r2 = await server.service.redeem('anon-d', codes[2], server.deps);
    rapporto.redeemSottoTetto = { status: r2.status, credits: r2.credits, reason: r2.reason };
    const ps = server.store.docs.wallets.get('anon-a').pseudonym;
    await page.fill('#ownerGrantPseudonym', ps);
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await page.waitForTimeout(2500);
    rapporto.regaloSottoTetto = await page.locator('#ownerMsg').innerText().catch(() => '');
    rapporto.saldoDopoRegalo = server.store.docs.wallets.get('anon-a').credits;
    rapporto.dailySottoTetto = await server.daily(Date.now() + 86_400_000);
    mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true });
    await page.screenshot({ path: join(APP_ROOT, 'tests', '.shots', 'owner-esplora.png'), fullPage: true });
  } finally {
    writeFileSync(OUT, JSON.stringify(rapporto, null, 2));
    try { await filo.app.close(); } catch (_) {}
    await server.chiudi();
  }
});

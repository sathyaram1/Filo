// Verifica #598, quinto giro — l'aspetto della pagina Crediti nei suoi tre
// stati (senza portafoglio, con portafoglio, owner) in tema chiaro e scuro:
// gli screenshot finiscono in tests/.shots/ (non tracciati) e li guarda chi
// verifica. In più: cosa resta del conteggio locale accanto al saldo del
// server, e il campo del codice con una riga incollata per intero.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriCrediti, cartellaFiloSecurity, simulaOwner, APP_ROOT,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

const SHOTS = join(APP_ROOT, 'tests', '.shots', 'verifica-598-giro5');
let server;
test.beforeEach(async () => { server = await avviaServer(); mkdirSync(SHOTS, { recursive: true }); });
test.afterEach(async () => { await server.chiudi(); });
const chiudi = async (filo) => { try { await filo.app.close(); } catch (_) {} };

async function tema(filo, page, t) {
  await filo.app.evaluate(async ({}, th) => {
    const s = (await globalThis.__filoStorage.get('settings')).settings || {};
    await globalThis.__filoStorage.set({ settings: { ...s, theme: th } });
  }, t);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('wallet').hidden, null, { timeout: 15_000 });
  await page.waitForTimeout(300);
}

test('tre stati, due temi: screenshot; il conteggio locale accanto al saldo del server; il campo del codice', async () => {
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await page.setViewportSize({ width: 1100, height: 900 }).catch(() => {});

    // Il campo del codice: una riga incollata per intero («Codice: ABCD-EFGH»)
    // supera i 16 caratteri del campo.
    await page.click('#inviteCode');
    await page.keyboard.type('Codice: ABCD-EFGH');
    const valore = await page.inputValue('#inviteCode');
    test.info().annotations.push({ type: 'nota', description: `digitando «Codice: ABCD-EFGH» il campo tiene «${valore}» (${valore.length} caratteri)` });
    await page.fill('#inviteCode', '');

    for (const t of ['light', 'dark']) {
      await tema(filo, page, t);
      await page.screenshot({ path: join(SHOTS, `senza-portafoglio-${t}.png`), fullPage: true });
    }

    const [code] = await server.codiciOwner(1);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    // Cosa resta del conteggio locale con il portafoglio attivo.
    const resto = await page.evaluate(() => ({
      usageEmpty: !document.getElementById('usageEmpty').hidden ? document.getElementById('usageEmpty').textContent : null,
      moves: !document.getElementById('movesSection').hidden ? document.getElementById('moves').innerText : null,
      usage: !document.getElementById('usageSection').hidden,
      refill: document.getElementById('refillHint').textContent,
    }));
    test.info().annotations.push({ type: 'nota', description: `con il portafoglio: ${JSON.stringify(resto)}` });
    for (const t of ['light', 'dark']) {
      await tema(filo, page, t);
      await page.screenshot({ path: join(SHOTS, `con-portafoglio-${t}.png`), fullPage: true });
    }

    // Owner, con un utente e i codici.
    await server.service.redeem('utente-aspetto', (await server.codiciOwner(1))[0], server.deps);
    await server.codiciOwner(3);
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    for (const t of ['light', 'dark']) {
      await tema(filo, page, t);
      await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(2, { timeout: 15_000 });
      await page.locator('#ownerUsers tbody tr.sn-wallet-user').first().click();
      await page.screenshot({ path: join(SHOTS, `owner-${t}.png`), fullPage: true });
    }
    // Niente testo che esce dal contenitore in orizzontale.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  } finally { await chiudi(filo); }
});

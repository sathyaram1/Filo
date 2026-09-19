// Primo giro — la tabella delle persone e la scheda di spesa di ciascuna,
// più i numeri calcolati (crediti vivi, tetto, quanto resta da elargire).
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity, APP_ROOT,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

const SHOTS = join(APP_ROOT, 'tests', '.shots');

async function ownerPronto() {
  const filo = await avviaFilo({ env: server.env });
  await fintoOpenRouter(filo.app, { fsBase: server.base });
  expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
  return filo;
}

// Due persone dentro, una delle quali ha speso e ha un registro d'uso.
async function duePersone() {
  const codes = await server.codiciOwner(2);
  await server.service.redeem('anon-a', codes[0], server.deps);
  await server.service.redeem('anon-b', codes[1], server.deps);
  const wa = server.store.docs.wallets.get('anon-a');
  wa.usageUsd = wa.limitUsd / 2; // ha consumato metà dei suoi crediti
  const pa = wa.pseudonym;
  server.store.docs.usage.push(
    { pseudonym: pa, at: '2026-09-18T10:00:00.000Z', action: 'chat', model: 'glm-5', servedBy: 'Baseten', promptTokens: 1200, completionTokens: 300, costUsd: 1.25, credits: 1500 },
    { pseudonym: pa, at: '2026-09-19T11:30:00.000Z', action: 'traduci', model: 'glm-5', servedBy: 'Fireworks', promptTokens: 400, completionTokens: 90, costUsd: 0.5, credits: 600 },
  );
  return { pa, pb: server.store.docs.wallets.get('anon-b').pseudonym };
}

test('i numeri che il server calcola si leggono in cima, e i crediti vivi scendono con la spesa', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const { pa } = await duePersone();
    const page = await apriOwner(filo);
    const numeri = page.locator('#ownerNumeri');
    await expect(numeri).toContainText('utenti', { timeout: 20_000 });
    const testo = await numeri.innerText();
    // Le tre cose chieste che si calcolano da sole.
    expect(testo).toMatch(/crediti elargiti su/);
    expect(testo).toMatch(/ancora elargibili/);
    expect(testo).toMatch(/crediti vivi/);
    expect(testo).toMatch(/\b2\b[\s\S]*utenti/);

    // Elargiti 10.000, ma metà dei crediti di una persona è già stata spesa:
    // i crediti vivi devono essere meno degli elargiti, non una copia.
    const vivi = await page.evaluate(() => {
      const li = [...document.querySelectorAll('#ownerNumeri li')].find((x) => /vivi/.test(x.innerText));
      return Number((li.querySelector('.sn-wallet-numero-valore').textContent || '').replace(/[^\d]/g, ''));
    });
    const elargiti = await page.evaluate(() => {
      const li = [...document.querySelectorAll('#ownerNumeri li')].find((x) => /elargiti/.test(x.innerText));
      return Number((li.querySelector('.sn-wallet-numero-valore').textContent || '').replace(/[^\d]/g, ''));
    });
    expect(elargiti).toBe(10_000);
    expect(vivi).toBeGreaterThan(6_000);
    expect(vivi).toBeLessThan(10_000);

    // E quei numeri non si toccano: non sono campi.
    expect(await page.locator('#ownerNumeri input, #ownerNumeri [contenteditable]').count()).toBe(0);
    // La riga della persona che ha speso mostra il suo consumo in dollari.
    const riga = page.locator('tr.sn-wallet-user', { hasText: pa });
    await expect(riga).toContainText('$', { timeout: 20_000 });
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('la riga di una persona apre la sua scheda di spesa, col clic e con la tastiera', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const { pa, pb } = await duePersone();
    const page = await apriOwner(filo);
    const riga = page.locator('tr.sn-wallet-user', { hasText: pa });
    await expect(riga).toBeVisible({ timeout: 20_000 });
    await riga.click();

    const scheda = page.locator('tr.sn-wallet-user-detail:not([hidden])');
    await expect(scheda).toBeVisible({ timeout: 20_000 });
    // Le info di spesa che l'owner ha chiesto.
    await expect(scheda).toContainText('Saldo', { timeout: 20_000 });
    await expect(scheda).toContainText(/Ricevuti/);
    await expect(scheda).toContainText(/Speso/);
    await expect(scheda).toContainText(/chat/);
    await expect(scheda).toContainText(/traduci/);
    await expect(scheda).toContainText(/1,25 \$/);      // la chiamata più cara
    await expect(scheda).toContainText(/Movimenti/);
    await expect(scheda).toContainText(/Invito riscattato/);
    await expect(scheda).toContainText(/Fireworks/);     // chi ha servito

    // Si richiude e si riapre: niente doppioni.
    await riga.click();
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])')).toHaveCount(0, { timeout: 15_000 });

    // La stessa cosa dalla tastiera: la riga si annuncia come un bottone.
    await riga.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])')).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])').first()).toContainText('Saldo');

    // L'altra persona, che non ha speso niente: la scheda si apre lo stesso.
    const riga2 = page.locator('tr.sn-wallet-user', { hasText: pb });
    await riga2.click();
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])').last()).toContainText('Saldo');
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'verifica-owner-scheda.png'), fullPage: true });
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('manopole, numeri e scheda si leggono in tema chiaro e in tema scuro', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const { pa } = await duePersone();
    const page = await apriOwner(filo);
    await expect(page.locator('#ownerNumeri')).toContainText('utenti', { timeout: 20_000 });
    await page.locator('tr.sn-wallet-user', { hasText: pa }).click();
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])')).toBeVisible({ timeout: 20_000 });
    mkdirSync(SHOTS, { recursive: true });

    for (const tema of ['light', 'dark']) {
      await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => document.documentElement.dataset.snTheme)).toBe(tema);
      // Il testo delle manopole e dei numeri non deve sparire nel fondo.
      const contrasto = await page.evaluate(() => {
        const leggi = (el) => {
          const s = getComputedStyle(el);
          const n = (c) => (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
          const lum = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
          let bg = s.backgroundColor; let p = el;
          while (p && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) { p = p.parentElement; bg = p ? getComputedStyle(p).backgroundColor : 'rgb(255,255,255)'; }
          return Math.abs(lum(n(s.color)) - lum(n(bg)));
        };
        const el = [
          document.querySelector('#ownerNumeri .sn-wallet-numero-valore'),
          document.querySelector('#ownerKnobs input'),
          document.querySelector('#ownerKnobs label'),
          document.querySelector('tr.sn-wallet-user-detail:not([hidden]) h4'),
        ].filter(Boolean);
        return el.map(leggi);
      });
      for (const c of contrasto) expect(c).toBeGreaterThan(0.25);
      await page.screenshot({ path: join(SHOTS, `verifica-owner-${tema}.png`), fullPage: true });
    }
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

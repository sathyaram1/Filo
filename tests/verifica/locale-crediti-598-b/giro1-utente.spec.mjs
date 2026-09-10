// Verifica del ramo crediti-598-b, primo giro — lato utente.
// Le tre cose chieste: i crediti locali di prima del riscatto si sommano a
// quelli d'ingresso; il saldo scende con i decimali quando si usano i modelli;
// (la pagina owner sta in giro1-owner).
import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriCrediti, apriOwner, simulaOwner, fintoOpenRouter,
  chiediInChat, cartellaFiloSecurity, RATE,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function chiudi(filo) { try { await filo.app.close(); } catch (_) {} }

// Saldo locale (il vecchio conteggio) portato a `target` con una ricompensa.
async function saldoLocale(app, target) {
  return app.evaluate(async ({}, t) => {
    const C = globalThis.SN_CREDITS;
    const pub = await C.getPublic();
    const now = pub.balanceExact != null ? pub.balanceExact : pub.balance;
    if (t > now) await C.award({ kind: 'feedback_sent', credits: t - now, ref: 'verifica' });
    const after = await C.getPublic();
    return after.balanceExact != null ? after.balanceExact : after.balance;
  }, target);
}

async function localeAttuale(app) {
  return app.evaluate(async () => { const p = await globalThis.SN_CREDITS.getPublic(); return p.balanceExact != null ? p.balanceExact : p.balance; });
}
// Come lo scrive la pagina (it-IT): migliaia col punto, decimale con la virgola.
// A mano: il Node dei test non ha per forza i dati della lingua italiana.
function fmt(n) {
  const v = Math.round(n * 10) / 10;
  const [int, dec] = String(v).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
}
const USD_PER_CREDIT = 0.0007 * RATE;
function creditiDaUsd(usd) { return Math.floor((usd / USD_PER_CREDIT) * 10 + 1e-6) / 10; }

test('i crediti che avevo prima del riscatto si sommano a quelli d’ingresso (e li vede anche l’owner)', async () => {
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    const errori = [];
    page.on('pageerror', (e) => errori.push(String(e && e.message || e)));
    // Il conteggio locale: 1000 di benvenuto + qualcosa guadagnato, con decimali.
    const locale = await saldoLocale(filo.app, 1234.6);
    expect(locale).toBeCloseTo(1234.6, 5);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#balance')).toHaveText('1.234,6');

    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemMsg')).toContainText(/riscattato/i, { timeout: 15_000 });
    // 5.000 d'ingresso + 1.234 miei = 6.234.
    await expect(page.locator('#balance')).toHaveText('6.234', { timeout: 15_000 });
    await expect(page.locator('#redeemForm')).toBeHidden();
    const w = [...server.store.docs.wallets.values()][0];
    expect(w.creditsGranted).toBe(6234);
    console.log('[nota]', 'errori della pagina durante il riscatto:', JSON.stringify(errori));
    console.log('[nota]', 'messaggio di riscatto:', await page.locator('#redeemMsg').innerText());
    expect(errori).toEqual([]);

    // Dopo un ricaricamento il saldo resta quello del server.
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#balance')).toHaveText('6.234', { timeout: 15_000 });

    // L'owner, nella sua pagina, vede 6.234 ricevuti per questo utente.
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const owner = await apriOwner(filo);
    const riga = owner.locator('#ownerUsers tbody tr.sn-wallet-user').first();
    await expect(riga).toBeVisible({ timeout: 15_000 });
    await expect(riga.locator('td').nth(2)).toHaveText('6.234');
  } finally { await chiudi(filo); }
});

test('sopra il tetto dei crediti migrabili: o tutti, o lo si dice (mai un taglio muto)', async () => {
  // Primo giro: rosso; corretto nello stesso giro.
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await saldoLocale(filo.app, 12_000);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemMsg')).toContainText(/riscattato/i, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const saldo = await page.locator('#balance').innerText();
    const msg = await page.locator('#redeemMsg').innerText();
    const w = [...server.store.docs.wallets.values()][0];
    console.log('[nota]', `12.000 locali → saldo «${saldo}», concessi ${w.creditsGranted}, messaggio «${msg}»`);
    if (w.creditsGranted < 17_000) {
      // Tagliati: il messaggio deve dirlo con i numeri (passati e dichiarati).
      expect(msg).toMatch(/10\.000/);
      expect(msg).toMatch(/12\.000/);
    }
  } finally { await chiudi(filo); }
});

test('il tetto globale basta per l’ingresso ma non per ingresso + miei crediti: cosa vede l’utente', async () => {
  // Primo giro: rosso; corretto nello stesso giro.
  const [code] = await server.codiciOwner(1);
  // 5.000 crediti = 4,09 $; 6.234 = 5,10 $. Tetto globale 5 $.
  await server.store.patchConfig({ maxGrantUsd: 5 });
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await saldoLocale(filo.app, 1234);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await page.waitForFunction(() => !/Un attimo/.test(document.getElementById('redeemMsg').textContent), null, { timeout: 15_000 });
    const msg = await page.locator('#redeemMsg').innerText();
    const w = [...server.store.docs.wallets.values()][0];
    console.log('[nota]', `tetto 5 $ → portafoglio ${w ? w.creditsGranted : 'NESSUNO'}, messaggio «${msg}»`);
    // Con lo stesso codice e senza crediti locali l'utente entrerebbe: rifiutarlo
    // per i suoi crediti in più è un'entrata negata. Atteso: entra (almeno con i 5.000).
    expect(w && w.creditsGranted >= 5000).toBeTruthy();
    // E il messaggio dice quanti dei suoi sono passati.
    expect(msg).toMatch(new RegExp(`${w.migratedLocal} dei 1\.234`));
  } finally { await chiudi(filo); }
});

test('il saldo scende con i decimali dopo l’uso dei modelli, nella pagina aperta, senza ricaricare', async () => {
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    const locale = Math.floor(await localeAttuale(filo.app));
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    // I locali di benvenuto si sommano ai 5.000.
    await expect(page.locator('#balance')).toHaveText(fmt(5000 + locale), { timeout: 15_000 });
    const w = [...server.store.docs.wallets.values()][0];
    const key = server.keys.keys.get(w.keyHash);
    const limit = key.limitUsd;

    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });

    // Una chiamata da 0,0021 $ (≈ 2,6 crediti). OpenRouter la conta sulla chiave.
    await fintoOpenRouter(filo.app, { text: 'Prima risposta.', costUsd: 0.0021 });
    key.usageUsd += 0.0021;
    await chiediInChat(dash, 'ciao');
    const atteso1 = fmt(creditiDaUsd(limit - key.usageUsd));
    await expect(page.locator('#balance')).toHaveText(atteso1, { timeout: 20_000 });
    console.log('[nota]', `dopo una chiamata da 0,0021 $ il saldo mostra «${atteso1}»`);
    expect(atteso1).toMatch(/,\d$/);

    // Una chiamata piccolissima (0,00005 $ ≈ 0,06 crediti): il numero deve muoversi lo stesso.
    await fintoOpenRouter(filo.app, { text: 'Seconda risposta.', costUsd: 0.00005 });
    key.usageUsd += 0.00005;
    await chiediInChat(dash, 'ancora');
    const atteso2 = fmt(creditiDaUsd(limit - key.usageUsd));
    await expect(page.locator('#balance')).toHaveText(atteso2, { timeout: 20_000 });
    console.log('[nota]', `dopo una chiamata da 0,00005 $ il saldo mostra «${atteso2}»`);
    expect(atteso2).not.toBe(atteso1);

    // Anche al ricaricamento: stesso numero.
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#balance')).toHaveText(atteso2, { timeout: 15_000 });
  } finally { await chiudi(filo); }
});

test('identità annullata e nuovo invito: i crediti locali vengono sommati una seconda volta?', async () => {
  test.setTimeout(150_000);
  const codes = await server.codiciOwner(2);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    const locale = Math.floor(await localeAttuale(filo.app));
    await page.fill('#inviteCode', codes[0]);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#balance')).toHaveText(fmt(5000 + locale), { timeout: 15_000 });
    // Il server annulla l'identità dell'installazione.
    for (const [rt, s] of server.sessions) if (rt.startsWith('rt-anon')) s.revoked = true;
    await filo.app.evaluate(() => globalThis.SN_WALLET_MAIN.expireIdentityForTest());
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#resetIdentityBtn')).toBeVisible({ timeout: 15_000 });
    await page.click('#resetIdentityBtn');
    await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
    await page.fill('#inviteCode', codes[1]);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    const wallets = [...server.store.docs.wallets.values()];
    const secondo = wallets[wallets.length - 1];
    console.log('[nota]', `secondo riscatto: migrati ${secondo.migratedLocal}, concessi ${secondo.creditsGranted}`);
    expect(wallets.length).toBe(2);
    // Corretto nel primo giro: quanto già dichiarato al primo riscatto non ripassa.
    expect(secondo.migratedLocal).toBe(0);
    expect(secondo.creditsGranted).toBe(5000);
  } finally { await chiudi(filo); }
});

test('nuova chiave dopo un deposito rovinato: l’utente riceve una conferma, non un «Un attimo…» che sparisce', async () => {
  // Primo giro: rosso; corretto nello stesso giro.
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const userData = filo.userData;
  try {
    const page = await apriCrediti(filo.openTab);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    // Variabile che la pagina assegna dopo il riscatto: se non esiste, in modo
    // stretto l'assegnazione lancia e il resto della funzione non gira.
    console.log('[nota]', 'typeof overviewLoaded nella pagina Crediti:', await page.evaluate(() => typeof overviewLoaded));
  } finally { await chiudi(filo); }
  writeFileSync(join(userData, 'wallet.bin'), Buffer.from('spazzatura-non-cifrata-0123456789'));
  const bis = await avviaFilo({ userData, env: server.env });
  try {
    const page = await apriCrediti(bis.openTab);
    await expect(page.locator('#reissueBtn')).toBeVisible({ timeout: 15_000 });
    await page.click('#reissueBtn');
    await expect(page.locator('#reissueBtn')).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    const nota = page.locator('#walletNote');
    const testo = (await nota.isHidden()) ? '(nascosta)' : await nota.innerText();
    console.log('[nota]', `dopo «Richiedi una nuova chiave» la nota dice: «${testo}»`);
    expect(testo).toMatch(/nuova chiave pronta|pronta/i);
  } finally { await chiudi(bis); rmSync(userData, { recursive: true, force: true }); }
});

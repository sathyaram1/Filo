// Verifica del ramo crediti-598-b, secondo giro — lato utente.
// Si riprovano le porte del primo giro (conferma della nuova chiave, tagli
// detti coi numeri, ingresso col tetto globale stretto, doppia migrazione) e
// se ne cercano altre: decimali nel conteggio locale, la chiave sparita (non
// rovinata), letture del saldo che tornano fuori ordine.
import { test, expect } from '@playwright/test';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriCrediti, fintoOpenRouter, chiamateOpenRouter,
  chiediInChat, cartellaFiloSecurity, RATE,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function chiudi(filo) { try { await filo.app.close(); } catch (_) {} }

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
function fmt(n) {
  const v = Math.round(n * 10) / 10;
  const [int, dec] = String(v).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
}
const USD_PER_CREDIT = 0.0007 * RATE;
function creditiDaUsd(usd) { return Math.floor((usd / USD_PER_CREDIT) * 10 + 1e-6) / 10; }
const primoWallet = () => [...server.store.docs.wallets.values()][0];

test('conteggio locale con i decimali: la frase dice i numeri, il saldo somma, e la frase resta anche dopo aver usato i modelli', async () => {
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    const locale = await saldoLocale(filo.app, 1234.6);
    expect(locale).toBeCloseTo(1234.6, 1);
    await page.fill('#inviteCode', `Il tuo codice: ${code.slice(0, 4)} ${code.slice(4)} !`);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#balance')).toHaveText(fmt(6234), { timeout: 15_000 });
    const nota = page.locator('#walletNote');
    await expect(nota).toBeVisible();
    const msg = await nota.innerText();
    console.log('[nota]', `1.234,6 locali → saldo «${await page.locator('#balance').innerText()}», frase «${msg}»`);
    expect(msg).toMatch(/5\.000/);
    expect(msg).toMatch(/1\.234/);
    expect(primoWallet().creditsGranted).toBe(6234);
    // Il modulo dell'invito non c'è più, i tre codici da dare ci sono.
    await expect(page.locator('#invites li')).toHaveCount(3);

    // Una chiamata ai modelli: il saldo scende, la frase del riscatto resta leggibile.
    const key = server.keys.keys.get(primoWallet().keyHash);
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    await fintoOpenRouter(filo.app, { text: 'Risposta.', costUsd: 0.0021 });
    key.usageUsd += 0.0021;
    await chiediInChat(dash, 'ciao');
    const atteso = fmt(creditiDaUsd(key.limitUsd - key.usageUsd));
    await expect(page.locator('#balance')).toHaveText(atteso, { timeout: 20_000 });
    expect(atteso).toMatch(/,\d$/);
    await expect(nota).toBeVisible();
    expect(await nota.innerText()).toBe(msg);
    // La chiamata è partita con la chiave personale appena ricevuta.
    const calls = await chiamateOpenRouter(filo.app);
    expect(calls.some((c) => c.auth === `Bearer ${key.key}`)).toBeTruthy();

    // Riaperta: stesso saldo, e la frase del riscatto non è più lì (era una conferma).
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#balance')).toHaveText(atteso, { timeout: 15_000 });
  } finally { await chiudi(filo); }
});

test('la chiave personale sparisce dal disco (non rovinata: cancellata): la pagina lo dice, «Richiedi una nuova chiave» conferma e i modelli ripartono con la chiave nuova', async () => {
  test.setTimeout(180_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const userData = filo.userData;
  let vecchia;
  try {
    const page = await apriCrediti(filo.openTab);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    vecchia = server.keys.keys.get(primoWallet().keyHash).key;
  } finally { await chiudi(filo); }
  const deposito = join(userData, 'wallet.bin');
  expect(existsSync(deposito)).toBeTruthy();
  rmSync(deposito, { force: true });
  const bis = await avviaFilo({ userData, env: server.env });
  try {
    const page = await apriCrediti(bis.openTab);
    await expect(page.locator('#walletNote')).toContainText(/non è su questo computer/i, { timeout: 15_000 });
    await expect(page.locator('#reissueBtn')).toBeVisible();
    await page.click('#reissueBtn');
    await expect(page.locator('#reissueBtn')).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    const nota = page.locator('#walletNote');
    const testo = (await nota.isHidden()) ? '(nascosta)' : await nota.innerText();
    console.log('[nota]', `chiave cancellata, dopo «Richiedi una nuova chiave»: «${testo}»`);
    expect(testo).toMatch(/nuova chiave pronta/i);
    await expect(page.locator('#balance')).toHaveText(/\d/, { timeout: 15_000 });

    // La chiave vecchia è spenta sul server, la nuova è quella che parte.
    const w = primoWallet();
    const nuova = server.keys.keys.get(w.keyHash).key;
    expect(nuova).not.toBe(vecchia);
    const dash = await bis.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    await fintoOpenRouter(bis.app, { text: 'Di nuovo qui.', costUsd: 0.001 });
    await chiediInChat(dash, 'ci sei?');
    const calls = await chiamateOpenRouter(bis.app);
    const auths = [...new Set(calls.map((c) => c.auth))];
    console.log('[nota]', `chiavi usate dopo la nuova chiave: ${auths.map((a) => a.slice(-12)).join(', ')} (nuova …${nuova.slice(-12)})`);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.auth === `Bearer ${nuova}`)).toBeTruthy();
  } finally { await chiudi(bis); rmSync(userData, { recursive: true, force: true }); }
});

test('tetto globale stretto: entro con la parte che ci sta, la frase dice quanti e perché; e la parte rimasta fuori, dopo che l’owner alza il tetto, torna?', async () => {
  test.setTimeout(150_000);
  const codes = await server.codiciOwner(2);
  // 5.000 d'ingresso = 4,09 $. Tetto 4,10 $: ci stanno 11 dei 1.234 locali.
  await server.store.patchConfig({ maxGrantUsd: 4.1 });
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await saldoLocale(filo.app, 1234);
    await page.fill('#inviteCode', codes[0]);
    await page.click('#redeemBtn');
    await page.waitForFunction(() => !/Un attimo/.test(document.getElementById('redeemMsg').textContent), null, { timeout: 15_000 });
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(1000);
    const msg = await page.locator('#walletNote').innerText();
    const w = primoWallet();
    console.log('[nota]', `tetto 4,10 $ → concessi ${w.creditsGranted}, migrati ${w.migratedLocal} di ${w.migratedRequested}, frase «${msg}»`);
    expect(w.creditsGranted).toBeGreaterThanOrEqual(5000);
    expect(w.migratedLocal).toBeGreaterThan(0);
    expect(w.migratedLocal).toBeLessThan(1234);
    expect(msg).toContain(`${w.migratedLocal} dei 1.234`);
    expect(msg).toMatch(/posto/);
    await expect(page.locator('#balance')).toHaveText(fmt(w.creditsGranted));

    // L'owner alza il tetto. I locali rimasti fuori («in questo periodo») hanno
    // una strada per entrare? Si prova l'unica che l'utente ha: identità
    // annullata e nuovo invito. Qui si registra cosa succede.
    await server.store.patchConfig({ maxGrantUsd: 50 });
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
    console.log('[nota]', `tetto alzato, nuovo invito: migrati ${secondo.migratedLocal} (i ${1234 - w.migratedLocal} rimasti fuori la prima volta)`);
    // Niente ripassa due volte: quanto già entrato la prima volta non torna.
    expect(secondo.migratedLocal).toBeLessThanOrEqual(1234 - w.migratedLocal);
  } finally { await chiudi(filo); }
});

test('due letture del saldo che tornano fuori ordine (server lento poi veloce): alla fine resta il numero più recente?', async () => {
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    const key = server.keys.keys.get(primoWallet().keyHash);
    const prima = await page.locator('#balance').innerText();

    // Prima lettura: parte lenta, legge il consumo A.
    server.flags.delayMs = 2500;
    key.usageUsd += 0.01;
    const attesoA = fmt(creditiDaUsd(key.limitUsd - key.usageUsd));
    await filo.app.evaluate(async () => { await globalThis.SN_CREDITS.award({ kind: 'feedback_sent', credits: 1, ref: 'a' }); });
    await page.waitForTimeout(300);
    // Seconda lettura: il server è tornato veloce e legge il consumo B (più alto).
    server.flags.delayMs = 0;
    key.usageUsd += 0.01;
    const attesoB = fmt(creditiDaUsd(key.limitUsd - key.usageUsd));
    await filo.app.evaluate(async () => { await globalThis.SN_CREDITS.award({ kind: 'feedback_sent', credits: 1, ref: 'b' }); });
    await expect(page.locator('#balance')).toHaveText(attesoB, { timeout: 5_000 });
    // Poi arriva la risposta lenta, con il numero vecchio.
    await page.waitForTimeout(3500);
    const finale = await page.locator('#balance').innerText();
    console.log('[nota]', `prima ${prima} · A (lenta) ${attesoA} · B (veloce) ${attesoB} · mostrato alla fine «${finale}»`);
    expect(finale).toBe(attesoB);
  } finally { await chiudi(filo); }
});

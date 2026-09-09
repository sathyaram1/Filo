// Verifica #598, quinto giro — le strade storte: ogni esito d'errore del
// riscatto ha un testo suo e il campo torna usabile; input limite e clic
// ripetuti; Filo riaperto senza rete o col server dei crediti giù; l'identità
// annullata sul server; la chiave personale sparita da questo computer;
// l'identità anonima spenta su Firebase.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriCrediti, cartellaFiloSecurity, ENV_OFFLINE, fintoOpenRouter, chiamateOpenRouter, chiediInChat,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });
const chiudi = async (filo) => { try { await filo.app.close(); } catch (_) {} };

async function riscatta(page, code) {
  await page.fill('#inviteCode', code);
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).not.toHaveText(/Un attimo/, { timeout: 20_000 });
  await expect(page.locator('#redeemMsg')).toBeVisible();
  return page.locator('#redeemMsg').innerText();
}

test('ogni esito del riscatto ha un testo chiaro, il campo torna usabile, gli input limite non rompono niente', async () => {
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    const campoUsabile = async () => {
      await expect(page.locator('#inviteCode')).toBeEnabled();
      await expect(page.locator('#redeemBtn')).toBeEnabled();
      await expect(page.locator('#redeemForm')).toBeVisible();
    };
    const n = () => server.counters.calls.filter((c) => c.name === 'walletRedeem').length;

    // Vuoto e soli spazi: non parte niente.
    await page.fill('#inviteCode', '');
    await page.click('#redeemBtn');
    await page.fill('#inviteCode', '     ');
    await page.press('#inviteCode', 'Enter');
    await page.waitForTimeout(400);
    expect(n()).toBe(0);
    await expect(page.locator('#redeemMsg')).toBeHidden();

    // Codice inesistente, HTML, emoji, 10.000 caratteri: «non esiste», niente markup iniettato.
    for (const brutto of ['ZZZZ-ZZZZ', '<script>alert(1)</script><b>x</b>', '🎁🎁🎁🎁🎁🎁🎁🎁', 'A'.repeat(10_000)]) {
      const msg = await riscatta(page, brutto);
      expect(msg).toMatch(/non esiste/);
      expect(await page.locator('#redeemMsg').innerHTML()).not.toMatch(/<script|<b>/);
      expect(await page.evaluate(() => document.querySelectorAll('script').length)).toBeLessThanOrEqual(1);
      await campoUsabile();
    }

    // Codice già usato.
    const [usato] = await server.codiciOwner(1);
    server.store.docs.invites.get(usato.replace('-', '')).usedBy = 'qualcun-altro';
    expect(await riscatta(page, usato)).toMatch(/già stato usato/);
    await campoUsabile();

    // Codice revocato → come inesistente.
    const [revocato] = await server.codiciOwner(1);
    server.store.docs.invites.get(revocato.replace('-', '')).revoked = true;
    expect(await riscatta(page, revocato)).toMatch(/non esiste/);

    // Codice proprio (l'identità di questa installazione ne è la proprietaria).
    const mioUid = [...server.sessions.values()].map((s) => s.uid).find((u) => u.startsWith('anon-'));
    expect(mioUid).toBeTruthy();
    server.store.writeInvites(['MIOCODIC'], mioUid, new Date().toISOString());
    expect(await riscatta(page, 'MIOC-ODIC')).toMatch(/tuo codice/);

    // Posti finiti: rifiuto, e la nota della pagina lo dice anche prima di provare.
    const [buono] = await server.codiciOwner(1);
    server.store.docs.config.invitesRemaining = 0;
    expect(await riscatta(page, buono)).toMatch(/posti sono finiti/);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#walletNote')).toContainText(/posti sono finiti/);
    await expect(page.locator('#redeemForm')).toBeVisible();
    delete server.store.docs.config.invitesRemaining;

    // Tetto globale.
    server.store.docs.config.maxGrantUsd = 1;
    expect(await riscatta(page, buono)).toMatch(/non possiamo dare altri crediti/);
    delete server.store.docs.config.maxGrantUsd;

    // Cambio mancante e Frankfurter muto: rifiuto pulito, nessuna chiave creata.
    delete server.store.docs.config.eurUsd;
    server.flags.frankDown = true;
    expect(await riscatta(page, buono)).toMatch(/manca il cambio/);
    expect(server.keys.calls.filter((c) => c.op === 'create')).toHaveLength(0);
    server.flags.frankDown = false;

    // Sale mancante: il server non è configurato.
    server.flags.salt = '';
    expect(await riscatta(page, buono)).toMatch(/non è ancora configurato/);
    server.flags.salt = 'sale-di-prova';

    // OpenRouter delle chiavi giù: niente chiave, niente portafoglio.
    server.keys.flags.down = true;
    expect(await riscatta(page, buono)).toMatch(/servizio dei modelli non ha risposto/);
    expect(server.store.docs.wallets.size).toBe(0);
    expect(server.keys.keys.size).toBe(0);
    server.keys.flags.down = false;

    // Server dei crediti: 500 e connessione chiusa → «non riesco a raggiungere il server».
    server.flags.walletDown = true;
    expect(await riscatta(page, buono)).toMatch(/Non riesco a raggiungere il server/);
    server.flags.walletDown = false;
    server.flags.walletHang = true;
    expect(await riscatta(page, buono)).toMatch(/Non riesco a raggiungere il server/);
    server.flags.walletHang = false;
    await campoUsabile();

    // Il codice resta valido e alla fine passa. Doppio clic + Invio durante
    // l'attesa: una richiesta sola.
    server.flags.delayMs = 1500;
    const prima = n();
    await page.fill('#inviteCode', buono);
    await page.click('#redeemBtn');
    await page.click('#redeemBtn', { force: true }).catch(() => {});
    await page.press('#inviteCode', 'Enter').catch(() => {});
    await page.keyboard.press('Enter');
    await expect(page.locator('#redeemMsg')).toContainText(/riscattato/i, { timeout: 20_000 });
    expect(n() - prima).toBe(1);
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#balance')).toHaveText('5.000');
    expect(server.store.docs.wallets.size).toBe(1);
  } finally { await chiudi(filo); }
});

test('riaperto senza rete, o col server dei crediti giù, chi ha il portafoglio vede l’ultimo saldo e nessuna promessa vuota', async () => {
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const userData = filo.userData;
  try {
    const page = await apriCrediti(filo.openTab);
    expect(await riscatta(page, code)).toMatch(/riscattato/i);
    await expect(page.locator('#balance')).toHaveText('5.000');
  } finally { await chiudi(filo); }

  const controlla = async (bis, nota) => {
    const page = await apriCrediti(bis.openTab);
    await expect(page.locator('#walletNote')).toContainText(nota, { timeout: 15_000 });
    await expect(page.locator('#balance')).toHaveText('5.000');
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#offlineHint')).toBeHidden();
    await expect(page.locator('#resetIdentityBtn')).toBeHidden();
    await expect(page.locator('#reissueBtn')).toBeHidden();
    const testo = await page.locator('main').innerText();
    expect(testo).not.toMatch(/mezzanotte|Accedi col tuo account|1\.010|codice d.invito|fetch failed/);
    await expect(page.locator('#invites li')).toHaveCount(3);
    // La home non chiede l'invito: la chiave c'è.
    const dash = await bis.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    await expect(dash.locator('#homeMessage')).not.toContainText(/codice d.invito/i);
  };

  // 1. Rete assente: identità e server irraggiungibili.
  const offline = await avviaFilo({ userData, env: ENV_OFFLINE });
  try { await controlla(offline, /server dei crediti non risponde/); } finally { await chiudi(offline); }

  // 2. Identità raggiungibile, funzioni dei crediti in errore.
  server.flags.walletDown = true;
  const giu = await avviaFilo({ userData, env: server.env });
  try { await controlla(giu, /server dei crediti non risponde/); } finally { await chiudi(giu); }
  server.flags.walletDown = false;

  // 3. Server su, OpenRouter delle chiavi muto: saldo dell'ultima lettura, dichiarato.
  server.keys.flags.down = true;
  const stale = await avviaFilo({ userData, env: server.env });
  try { await controlla(stale, /ultima lettura|non risponde/); } finally { await chiudi(stale); rmSync(userData, { recursive: true, force: true }); }
});

test('identità annullata sul server: la pagina lo dice, niente saldo finto, «Ricomincia» crea l’identità nuova e il riscatto riparte', async () => {
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const userData = filo.userData;
  try {
    const page = await apriCrediti(filo.openTab);
    expect(await riscatta(page, code)).toMatch(/riscattato/i);
  } finally { await chiudi(filo); }
  for (const s of server.sessions.values()) if (s.uid.startsWith('anon-')) s.revoked = true;

  const bis = await avviaFilo({ userData, env: server.env });
  try {
    const page = await apriCrediti(bis.openTab);
    await expect(page.locator('#walletNote')).toContainText(/annullata/, { timeout: 15_000 });
    await expect(page.locator('#resetIdentityBtn')).toBeVisible();
    await expect(page.locator('#redeemForm')).toBeHidden();
    await expect(page.locator('#hero')).toBeHidden();
    await expect(page.locator('#refillHint')).toBeHidden();
    await expect(page.locator('#offlineHint')).toBeHidden();
    const testo = await page.locator('main').innerText();
    expect(testo).not.toMatch(/mezzanotte|Accedi col tuo account|1\.010/);
    // Nessuna identità nuova creata in silenzio.
    expect(server.counters.signUps).toBe(1);

    await page.click('#resetIdentityBtn');
    await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#resetIdentityBtn')).toBeHidden();
    await expect(page.locator('#walletNote')).toBeHidden();
    const [nuovo] = await server.codiciOwner(1);
    expect(await riscatta(page, nuovo)).toMatch(/riscattato/i);
    expect(server.counters.signUps).toBe(2);
    await expect(page.locator('#balance')).toHaveText('5.000');
    expect(existsSync(join(userData, 'wallet.bin'))).toBe(true);
  } finally { await chiudi(bis); rmSync(userData, { recursive: true, force: true }); }
});

test('chiave personale sparita da questo computer: nota, «Richiedi una nuova chiave», la vecchia si spegne e il saldo resta', async () => {
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const userData = filo.userData;
  try {
    const page = await apriCrediti(filo.openTab);
    expect(await riscatta(page, code)).toMatch(/riscattato/i);
  } finally { await chiudi(filo); }
  const vecchia = [...server.keys.keys.values()][0];
  // Un po' di consumo sulla chiave vecchia: il resto deve passare alla nuova.
  vecchia.usageUsd = 0.5;
  rmSync(join(userData, 'wallet.bin'), { force: true });

  const bis = await avviaFilo({ userData, env: server.env });
  try {
    const page = await apriCrediti(bis.openTab);
    await expect(page.locator('#walletNote')).toContainText(/chiave personale non è su questo computer/, { timeout: 15_000 });
    await expect(page.locator('#reissueBtn')).toBeVisible();
    await expect(page.locator('#redeemForm')).toBeHidden();
    const saldoPrima = await page.locator('#balance').innerText();
    expect(await bis.app.evaluate(async () => globalThis.SN_WALLET_MAIN.keySource())).toBe('none');
    // Senza chiave la home chiede l'invito? No: il portafoglio c'è, e la strada è il pulsante qui.
    await page.click('#reissueBtn');
    await expect(page.locator('#walletNote')).toContainText(/Nuova chiave pronta/, { timeout: 15_000 });
    await expect(page.locator('#reissueBtn')).toBeHidden();
    await expect(page.locator('#balance')).toHaveText(saldoPrima);
    expect(server.keys.keys.size).toBe(2);
    expect(vecchia.disabled).toBe(true);
    const nuova = [...server.keys.keys.values()][1];
    expect(nuova.disabled).toBe(false);
    expect(nuova.limitUsd).toBeCloseTo(vecchia.limitUsd - 0.5, 6);
    expect(await bis.app.evaluate(async () => (await globalThis.__filoHandlers.getEffectiveSettings()).apiKeys.openrouter)).toBe(nuova.key);
    expect(readFileSync(join(userData, 'wallet.bin'), 'latin1')).not.toContain('sk-or-v1');
    // Al riavvio la nuova chiave è ancora qui.
  } finally { await chiudi(bis); }
  const ter = await avviaFilo({ userData, env: server.env });
  try {
    const page = await apriCrediti(ter.openTab);
    await expect(page.locator('#reissueBtn')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#walletNote')).toBeHidden();
    expect(await ter.app.evaluate(async () => globalThis.SN_WALLET_MAIN.keySource())).toBe('personal');
  } finally { await chiudi(ter); rmSync(userData, { recursive: true, force: true }); }
});

test('identità anonima spenta su Firebase o identità che non si crea: la nota lo dice e il riscatto non manda a guardare la rete', async () => {
  server.flags.anonDisabled = true;
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await expect(page.locator('#walletNote')).toContainText(/identità anonima non abilitata/, { timeout: 15_000 });
    const [code] = await server.codiciOwner(1);
    const msg = await riscatta(page, code);
    expect(msg).toMatch(/identità/);
    expect(msg).not.toMatch(/controlla la connessione/);
    // Il server dei crediti non è stato chiamato senza identità.
    expect(server.counters.calls.filter((c) => c.name === 'walletRedeem')).toHaveLength(0);
    // Chat senza nessuna chiave: nessuna chiamata ai modelli.
    await fintoOpenRouter(filo.app);
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    const bolla = await chiediInChat(dash, 'ciao');
    await expect(bolla).toContainText(/codice d.invito/i);
    expect((await chiamateOpenRouter(filo.app)).filter((c) => !c.url.endsWith('/models'))).toHaveLength(0);
  } finally { await chiudi(filo); }
});

// Verifica del ramo crediti-598-b, terzo giro — la pagina «Inviti e utenti».
// Strade nuove: i decimali del saldo nella tabella degli utenti, la pagina a
// finestre strette (1.000 e 720 pixel: niente scorrimento orizzontale della
// pagina), il rimando indietro, il server muto, e un regalo a un utente che
// ha la SUA pagina Crediti aperta su un'altra installazione.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriCrediti, apriOwner, simulaOwner, fintoOpenRouter,
  chiediInChat, cartellaFiloSecurity, APP_ROOT, RATE,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function chiudi(filo) { try { await filo.app.close(); } catch (_) {} }
const SHOTS = join(APP_ROOT, 'tests', '.shots');

function fmt(n) {
  const v = Math.round(n * 10) / 10;
  const [int, dec] = String(v).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
}
const USD_PER_CREDIT = 0.0007 * RATE;
function creditiDaUsd(usd) { return Math.floor((usd / USD_PER_CREDIT) * 10 + 1e-6) / 10; }

async function finestra(filo, w, h) {
  await filo.app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(w, h);
  }, [w, h]);
}
async function sbordo(page) {
  return page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth,
  }));
}

test('un utente consuma: l’owner vede il saldo con il decimale nella tabella; la pagina regge a 1.000 e 720 pixel senza scorrimento orizzontale; il rimando indietro porta ai Crediti', async () => {
  test.setTimeout(200_000);
  const [code] = await server.codiciOwner(1);
  // L'utente: un'altra installazione, riscatta e usa i modelli.
  const utente = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(utente.openTab);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    const w = [...server.store.docs.wallets.values()][0];
    const key = server.keys.keys.get(w.keyHash);
    const dash = await utente.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    await fintoOpenRouter(utente.app, { text: 'Risposta.', costUsd: 0.0021 });
    key.usageUsd += 0.0021;
    await chiediInChat(dash, 'ciao');
    const atteso = fmt(creditiDaUsd(key.limitUsd - key.usageUsd));
    await expect(page.locator('#balance')).toHaveText(atteso, { timeout: 20_000 });
    expect(atteso).toMatch(/,\d$/);
  } finally { await chiudi(utente); }

  // L'owner apre la sua pagina.
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    await finestra(filo, 1000, 800);
    const page = await apriOwner(filo);
    await expect(page.locator('#ownerUsers')).toBeVisible({ timeout: 15_000 });
    const w = [...server.store.docs.wallets.values()][0];
    const key = server.keys.keys.get(w.keyHash);
    const atteso = fmt(creditiDaUsd(key.limitUsd - key.usageUsd));
    const riga = page.locator('#ownerUsers tbody tr.sn-wallet-user').first();
    const celle = await riga.locator('td').allInnerTexts();
    console.log('[nota]', `riga utente nella tabella owner: ${JSON.stringify(celle)} (saldo atteso «${atteso}»)`);
    expect(celle[1]).toBe(atteso);
    expect(celle[2]).toBe(fmt(w.creditsGranted));
    expect(celle[5]).toBe('te');

    mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(300);
    let s = await sbordo(page);
    await page.screenshot({ path: join(SHOTS, 'verifica-598b-giro3-owner-1000.png'), fullPage: true });
    console.log('[nota]', `a 1.000 px: larghezza pagina ${s.scrollW} su ${s.clientW}`);
    expect(s.scrollW).toBeLessThanOrEqual(s.clientW + 1);

    await finestra(filo, 720, 800);
    await page.waitForTimeout(400);
    s = await sbordo(page);
    await page.screenshot({ path: join(SHOTS, 'verifica-598b-giro3-owner-720.png'), fullPage: true });
    console.log('[nota]', `a 720 px: larghezza pagina ${s.scrollW} su ${s.clientW}`);
    expect(s.scrollW).toBeLessThanOrEqual(s.clientW + 1);
    // I due moduli, se vanno a capo, restano interi (bottone visibile e dentro la finestra).
    for (const id of ['#ownerInvitesBtn', '#ownerGrantBtn']) {
      const b = await page.locator(id).boundingBox();
      expect(b).toBeTruthy();
      expect(b.x + b.width).toBeLessThanOrEqual(s.clientW + 1);
    }

    // Rimando indietro.
    await finestra(filo, 1400, 900);
    await page.click('a[href="credits.html"]');
    await page.waitForURL(/credits\.html$/, { timeout: 15_000 });
    await page.waitForFunction(() => !document.getElementById('wallet').hidden, null, { timeout: 15_000 });
    await expect(page.locator('#ownerLink')).toBeVisible();
    await page.click('#ownerLink a');
    await page.waitForURL(/owner\.html$/, { timeout: 15_000 });
    await expect(page.locator('#ownerSection')).toBeVisible({ timeout: 15_000 });
  } finally { await chiudi(filo); }
});

test('server dei crediti muto: la pagina owner lo dice con una frase, non con un codice; tornato il server, la vista arriva senza riaprire la pagina?', async () => {
  test.setTimeout(150_000);
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    server.flags.walletDown = true;
    const page = await apriOwner(filo);
    await expect(page.locator('#ownerTotals')).toHaveText(/\S/, { timeout: 15_000 });
    const testo = await page.locator('#ownerTotals').innerText();
    console.log('[nota]', `server giù, riga dei totali: «${testo}»`);
    expect(testo).toMatch(/non disponibile/i);
    // Tornato il server: la pagina si rilegge da sola? Si aspetta un po' e si guarda.
    server.flags.walletDown = false;
    await page.waitForTimeout(6000);
    const dopo = await page.locator('#ownerTotals').innerText();
    console.log('[nota]', `server tornato, dopo 6 s senza toccare niente: «${dopo}»`);
    // Con un clic su Genera la vista si rilegge comunque.
    await page.fill('#ownerInviteCount', '1');
    await page.click('#ownerInvitesBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/1 codici nuovi/, { timeout: 15_000 });
    await expect(page.locator('#ownerTotals')).toContainText(/utenti/, { timeout: 15_000 });
  } finally { await chiudi(filo); }
});

test('regalo a un utente che ha la sua pagina Crediti aperta su un’altra installazione: quando lo vede?', async () => {
  test.setTimeout(240_000);
  const [code] = await server.codiciOwner(1);
  const utente = await avviaFilo({ env: server.env });
  const owner = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(utente.openTab);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    const w = [...server.store.docs.wallets.values()][0];
    const granted = w.creditsGranted;
    await expect(page.locator('#balance')).toHaveText(fmt(granted), { timeout: 15_000 });
    const pseudonimo = w.pseudonym;

    expect((await simulaOwner(owner.app, server)).isAdmin).toBe(true);
    const op = await apriOwner(owner);
    await expect(op.locator('#ownerUsers')).toBeVisible({ timeout: 15_000 });
    await op.fill('#ownerGrantPseudonym', pseudonimo);
    await op.fill('#ownerGrantCredits', '250');
    await op.click('#ownerGrantBtn');
    await expect(op.locator('#ownerMsg')).toContainText(/\+250 crediti/, { timeout: 15_000 });
    // La tabella dell'owner si è riletta: 5.250.
    await expect(op.locator('#ownerUsers tbody tr.sn-wallet-user td').nth(1)).toHaveText(fmt(granted + 250), { timeout: 15_000 });

    // L'utente, pagina aperta, senza fare niente: 15 secondi.
    await page.waitForTimeout(15_000);
    const fermo = await page.locator('#balance').innerText();
    console.log('[nota]', `regalo di 250 dall'owner: la pagina Crediti dell'utente, aperta e ferma per 15 s, dice «${fermo}»`);
    // Ricaricata: il regalo c'è.
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden, null, { timeout: 15_000 });
    await expect(page.locator('#balance')).toHaveText(fmt(granted + 250), { timeout: 15_000 });
    // Nessun avviso sulla home dell'utente per il regalo? Si registra.
    const dash = await utente.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    await dash.waitForTimeout(2000);
    const toast = await dash.locator('.sn-toast, .dash-toast, [class*="toast"]').allInnerTexts().catch(() => []);
    console.log('[nota]', `avvisi sulla home dell'utente dopo il regalo: ${JSON.stringify(toast)}`);
  } finally { await chiudi(utente); await chiudi(owner); }
});

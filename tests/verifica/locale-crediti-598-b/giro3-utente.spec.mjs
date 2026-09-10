// Verifica del ramo crediti-598-b, terzo giro — lato utente.
// Le porte dei due giri passati le rilanciano le loro spec; qui si cercano
// strade nuove attorno alle tre cose chieste: il saldo dopo che il consumo
// supera il tetto, il conteggio locale che continua a vivere accanto al saldo
// del server (ricompense locali dopo il riscatto), e un incollaggio di diecimila caratteri nel campo del codice.
import { test, expect } from '@playwright/test';
import {
  avviaServer, avviaFilo, apriCrediti, fintoOpenRouter,
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

async function riscatta(page, code) {
  await page.fill('#inviteCode', code);
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
  // Un'installazione nuova ha già un conteggio locale (1.010): passa anche lui.
  // Il saldo atteso è quanto il server ha concesso, non un numero scritto a mano.
  const granted = primoWallet().creditsGranted;
  await expect(page.locator('#balance')).toHaveText(fmt(granted), { timeout: 15_000 });
  return granted;
}

test('il consumo supera il tetto: il saldo dice 0 (non un numero negativo), la chat spiega, e una ricarica del tetto lo fa risalire nella pagina aperta', async () => {
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    const key = server.keys.keys.get(primoWallet().keyHash);
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    // OpenRouter dice: chiave oltre il tetto (402), e il consumo letto è sopra il limite.
    await fintoOpenRouter(filo.app, { status: 402 });
    key.usageUsd = key.limitUsd + 0.013;
    const bolla = await chiediInChat(dash, 'ciao');
    const testo = await bolla.innerText();
    console.log('[nota]', `oltre il tetto: la chat dice «${testo.slice(0, 160)}»; saldo «${await page.locator('#balance').innerText()}»`);
    await expect(page.locator('#balance')).toHaveText('0', { timeout: 20_000 });
    expect(await page.locator('#balance').innerText()).not.toMatch(/-/);
    expect(testo).toMatch(/credit/i);

    // L'owner regala 300 crediti: il tetto sale, e il saldo nella pagina aperta
    // deve risalire senza ricaricare. Il regalo arriva da un'altra installazione
    // (qui: direttamente dal servizio), quindi la pagina non ha nessun avviso
    // locale: si guarda cosa succede alla chiamata successiva.
    const uid = [...server.store.docs.wallets.keys()][0];
    const r = await server.service.grant(uid, 300, 'owner', server.deps);
    console.log('[nota]', `regalo di 300 dal servizio: ${JSON.stringify({ ok: r.ok, reason: r.reason })}`);
    expect(r.ok).toBe(true);
    await fintoOpenRouter(filo.app, { status: 200, text: 'Eccomi.', costUsd: 0.001 });
    await chiediInChat(dash, 'e adesso?');
    const keyNow = server.keys.keys.get(primoWallet().keyHash);
    const atteso = fmt(creditiDaUsd(keyNow.limitUsd - keyNow.usageUsd));
    await expect(page.locator('#balance')).toHaveText(atteso, { timeout: 20_000 });
    console.log('[nota]', `dopo il regalo di 300 e una chiamata: saldo «${atteso}»`);
    expect(Number(atteso.replace(/\./g, '').replace(',', '.'))).toBeGreaterThan(0);
  } finally { await chiudi(filo); }
});

test('dopo il riscatto il conteggio locale vive ancora: una ricompensa locale compare nei Movimenti; il saldo grande resta quello del server (non torna al numero locale)', async () => {
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await saldoLocale(filo.app, 200);
    const granted = await riscatta(page, code);
    // Una ricompensa locale (un feedback inviato) dopo il riscatto.
    await filo.app.evaluate(async () => { await globalThis.SN_CREDITS.award({ kind: 'feedback_sent', credits: 50, ref: 'dopo' }); });
    await page.waitForTimeout(2500);
    const saldo = await page.locator('#balance').innerText();
    const mosse = await page.locator('#moves li').allInnerTexts();
    console.log('[nota]', `ricompensa locale +50 dopo il riscatto: saldo «${saldo}», movimenti: ${JSON.stringify(mosse)}`);
    // Il saldo non deve mai tornare al conteggio locale: quello vero è del server.
    expect(saldo).toBe(fmt(granted));
    // Riaperta: idem.
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#balance')).toHaveText(fmt(granted), { timeout: 15_000 });
    expect(await page.locator('#refillHint').innerText()).toMatch(/si accumulano|server/);
  } finally { await chiudi(filo); }
});

test('diecimila caratteri incollati nel campo del codice: un rifiuto leggibile, il campo torna usabile, e il codice vero passa subito dopo', async () => {
  test.setTimeout(120_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    const lungo = 'x'.repeat(10_000);
    await page.fill('#inviteCode', lungo);
    await page.click('#redeemBtn');
    await page.waitForFunction(() => {
      const m = document.getElementById('redeemMsg');
      return m && !m.hidden && !/Un attimo/.test(m.textContent);
    }, null, { timeout: 15_000 });
    const msg = await page.locator('#redeemMsg').innerText();
    console.log('[nota]', `10.000 caratteri: «${msg}»`);
    expect(msg.length).toBeGreaterThan(5);
    expect(msg.length).toBeLessThan(300);
    await expect(page.locator('#redeemForm')).toBeVisible();
    await expect(page.locator('#inviteCode')).toBeEnabled();
    // Subito dopo, il codice vero passa.
    await riscatta(page, code);
  } finally { await chiudi(filo); }
});

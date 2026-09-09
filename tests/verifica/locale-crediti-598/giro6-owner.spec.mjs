// Verifica #598, sesto giro — porte nuove sul lato owner: un codice sfuggito
// di mano che non si può ritirare, il regalo con numeri e pseudonimi scritti
// male, il numero di codici fuori misura, e quante volte una sessione normale
// bussa al server dei crediti.
import { test, expect } from '@playwright/test';
import {
  avviaServer, avviaFilo, apriCrediti, simulaOwner, fintoOpenRouter, chiediInChat,
  cartellaFiloSecurity, OWNER_UID,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function chiudi(filo) { try { await filo.app.close(); } catch (_) {} }

test('un codice dell’owner ancora da dare si può ritirare (dato a chi non si voleva, o finito in un posto pubblico)', async () => {
  // Sesto giro: il server conosce lo stato «revocato» ma dalla pagina non c'è
  // nessuna strada per arrivarci (né un tasto, né il tasto destro). Atteso
  // rosso finché non viene corretto (poi togliere questa riga).
  test.fail(true, 'nessun comando di revoca di un codice nella pagina Crediti dell’owner');
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const page = await apriCrediti(filo.openTab);
    await page.fill('#ownerInviteCount', '2');
    await page.click('#ownerInvitesBtn');
    await expect(page.locator('#ownerCodes li')).toHaveCount(2, { timeout: 15_000 });
    const li = page.locator('#ownerCodes li').first();
    const code = (await li.locator('.sn-wallet-code').innerText()).replace('-', '');
    // Una strada qualunque: un tasto nella riga, o una voce del tasto destro.
    let trovato = await li.locator('button, [role=button]', { hasText: /ritira|revoca|annulla/i }).count();
    if (!trovato) {
      await li.click({ button: 'right' });
      await page.waitForTimeout(400);
      trovato = await page.locator('text=/ritira|revoca|annulla/i').count();
    }
    expect(trovato).toBeGreaterThan(0);
    await page.locator('text=/ritira|revoca|annulla/i').first().click();
    await expect.poll(() => server.store.docs.invites.get(code)?.revoked, { timeout: 15_000 }).toBe(true);
    // Un utente che prova quel codice adesso viene rifiutato.
    const esito = await server.service.redeem('anon-tardi', code, server.deps);
    expect(esito.status).not.toBe('ok');
  } finally { await chiudi(filo); }
});

test('regalo e codici con valori scritti male: decimali, pseudonimo con spazi o maiuscole, numero di codici fuori misura', async () => {
  const [code] = await server.codiciOwner(1);
  const u = await server.service.redeem('anon-utente', code, server.deps);
  expect(u.status).toBe('ok');
  const pseudonym = server.store.docs.wallets.get('anon-utente').pseudonym;
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const page = await apriCrediti(filo.openTab);
    await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(1, { timeout: 15_000 });

    // Pseudonimo con spazi intorno e in maiuscolo (copiato da un messaggio).
    await page.fill('#ownerGrantPseudonym', ` ${pseudonym.toUpperCase()} `.slice(0, 16));
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).not.toBeEmpty({ timeout: 15_000 });
    const m1 = await page.locator('#ownerMsg').innerText();
    console.log('[nota]', `pseudonimo maiuscolo → «${m1}»`);

    // Decimali: 10,7 crediti → o 10 con la cifra detta, o un rifiuto chiaro; mai una cosa muta.
    await page.fill('#ownerGrantPseudonym', pseudonym);
    await page.fill('#ownerGrantCredits', '10.7');
    await page.click('#ownerGrantBtn');
    await page.waitForTimeout(1500);
    const m2 = await page.locator('#ownerMsg').innerText();
    const granted = server.store.docs.wallets.get('anon-utente').creditsGranted;
    console.log('[nota]', `10.7 crediti → «${m2}», concessi ${granted}`);
    if (granted > 5000) expect(m2).toMatch(new RegExp(`\\+${granted - 5000} crediti`));

    // Zero e negativo: niente parte, niente cambia.
    for (const v of ['0', '-5']) {
      await page.fill('#ownerGrantCredits', v);
      await page.click('#ownerGrantBtn');
      await page.waitForTimeout(800);
    }
    expect(server.store.docs.wallets.get('anon-utente').creditsGranted).toBe(granted);

    // Numero di codici fuori misura: 1000 (il campo dice al massimo 200).
    const prima = server.store.docs.invites.size;
    await page.fill('#ownerInviteCount', '1000');
    await page.click('#ownerInvitesBtn');
    await page.waitForTimeout(2000);
    const dopo = server.store.docs.invites.size;
    const m3 = await page.locator('#ownerMsg').innerText();
    console.log('[nota]', `1000 codici → creati ${dopo - prima}, «${m3}»`);
    // O non parte (con il campo che lo dice) o crea quanti ne ha detto: mai un numero diverso in silenzio.
    if (dopo - prima > 0) expect(m3).toMatch(new RegExp(`${dopo - prima} codici`));
  } finally { await chiudi(filo); }
});

test('mille codici chiesti dal canale dei messaggi: o mille, o un rifiuto, mai cinquecento in silenzio', async () => {
  // Sesto giro: il server taglia a 500 senza dirlo. Atteso rosso finché non
  // viene corretto (poi togliere questa riga).
  test.fail(true, 'il server crea 500 codici quando ne sono stati chiesti 1000, senza dirlo');
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const r = await filo.app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_owner_invites', count: 1000 }, { isShell: true }, 'filo://credits'));
    console.log('[nota] messaggio count=1000 →', JSON.stringify({ ok: r?.ok, codici: r?.codes?.length, status: r?.status, message: r?.message }));
    if (r?.ok) expect(r.codes.length).toBe(1000);
    else expect(String(r?.message || r?.status || '')).toMatch(/\d/);
  } finally { await chiudi(filo); }
});

test('quante volte una sessione normale chiede lo stato al server: apertura, home, chat, pagina Crediti', async () => {
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    server.counters.calls.length = 0;
    await fintoOpenRouter(filo.app, { text: 'Ok.' });
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
    for (let i = 0; i < 3; i++) await chiediInChat(dash, `domanda ${i}`);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 15_000 });
    const n = server.counters.calls.filter((c) => c.name === 'walletState').length;
    console.log('[nota]', `walletState chiamato ${n} volte (home + 3 domande + Crediti)`);
    // Un ordine di grandezza ragionevole: non una chiamata per ogni messaggio in chat.
    expect(n).toBeLessThanOrEqual(6);
    expect(OWNER_UID).toBeTruthy();
  } finally { await chiudi(filo); }
});

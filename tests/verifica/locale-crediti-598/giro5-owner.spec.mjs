// Verifica #598, quinto giro — la parte dell'owner dentro Filo: senza accesso
// i comandi sono negati e il server non viene chiamato; con l'accesso Google
// (simulato nel processo principale) la sezione mostra totali, codici (che
// restano dopo un ricaricamento, con quelli usati e da chi), la tabella degli
// utenti col dettaglio, il regalo con i suoi rifiuti spiegati, e mai un uid.
// In coda: la giornaliera del server e quello che l'utente vede dopo.
import { test, expect } from '@playwright/test';
import {
  avviaServer, avviaFilo, apriCrediti, cartellaFiloSecurity, simulaOwner, OWNER_UID, RATE,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });
const chiudi = async (filo) => { try { await filo.app.close(); } catch (_) {} };

// Un utente entrato prima, con un po' di consumo e qualche riga nel registro.
async function utenteEsistente(uid = 'utente-uno') {
  const [code] = await server.codiciOwner(1);
  const r = await server.service.redeem(uid, code, server.deps);
  expect(r.status).toBe('ok');
  const w = server.store.docs.wallets.get(uid);
  const hash = server.keys.hashOf(r.key);
  server.keys.keys.get(hash).usageUsd = 0.4;
  const oggi = new Date().toISOString();
  server.store.docs.usage.push(
    { pseudonym: w.pseudonym, at: oggi, action: 'filo_chat', model: 'x/y', servedBy: 'H', promptTokens: 10, completionTokens: 5, costUsd: 0.25, credits: 300 },
    { pseudonym: w.pseudonym, at: oggi, action: 'translate', model: 'x/y', servedBy: 'H', promptTokens: 10, completionTokens: 5, costUsd: 0.15, credits: 200 },
  );
  return { uid, pseudonym: w.pseudonym, code, key: r.key };
}

test('senza accesso i comandi dell’owner sono negati senza chiamare il server; una pagina web non arriva ai messaggi del portafoglio', async () => {
  const filo = await avviaFilo({ env: server.env });
  try {
    const r = await filo.app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_owner_invites', count: 3 }, { isShell: true }, 'filo://credits'));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not_admin');
    const o = await filo.app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_owner_overview' }, { isShell: true }, 'filo://credits'));
    expect(o.ok).toBe(false);
    expect(server.counters.calls.filter((c) => /walletCreateInvites|walletOverview|walletGrant/.test(c.name))).toHaveLength(0);
    // Origine di un sito web: rifiuto per tutti i messaggi del portafoglio.
    for (const type of ['wallet_state', 'wallet_redeem', 'wallet_reissue', 'wallet_reset_identity', 'wallet_owner_overview', 'wallet_owner_grant', 'wallet_owner_invites']) {
      const x = await filo.app.evaluate(async ({}, t) => globalThis.SN_HANDLE_MESSAGE({ type: t, code: 'AAAA-BBBB', count: 1 }, { isShell: false }, 'https://example.com'), type);
      expect(x && x.ok).toBe(false);
      expect(x.error).toBe('forbidden');
    }
    expect(server.counters.calls.filter((c) => c.name === 'walletRedeem' || c.name === 'walletReissue')).toHaveLength(0);
    const page = await apriCrediti(filo.openTab);
    await expect(page.locator('#ownerSection')).toBeHidden();
  } finally { await chiudi(filo); }
});

test('con l’accesso: totali, codici che restano, tabella con dettaglio, regalo e rifiuti spiegati, nessun uid', async () => {
  const u = await utenteEsistente();
  await server.reconcile();
  const filo = await avviaFilo({ env: server.env });
  try {
    const login = await simulaOwner(filo.app, server);
    expect(login.ok).toBe(true);
    expect(login.isAdmin).toBe(true);

    const page = await apriCrediti(filo.openTab);
    await expect(page.locator('#ownerSection')).toBeVisible();
    await expect(page.locator('#ownerTotals')).toContainText(/1 utenti/, { timeout: 15_000 });
    await expect(page.locator('#ownerTotals')).toContainText(/su 50 \$ elargibili/);
    await expect(page.locator('#ownerTotals')).toContainText(/inviti riscattabili rimasti 9/);
    await expect(page.locator('#ownerTotals')).toContainText(new RegExp(`cambio ${String(RATE).replace('.', '[.,]')}`));

    // Il codice già usato dall'utente compare, barrato, con lo pseudonimo.
    await expect(page.locator('#ownerCodes li')).toHaveCount(1);
    await expect(page.locator('#ownerCodes li.is-used .sn-wallet-invite-state')).toContainText(`da ${u.pseudonym}`);
    await expect(page.locator('#ownerCodes li.is-used .sn-wallet-code')).toBeDisabled();

    // Genera 3 codici: il numero arriva al server, i codici restano dopo il ricaricamento.
    await page.fill('#ownerInviteCount', '3');
    await page.click('#ownerInvitesBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/3 codici nuovi/, { timeout: 15_000 });
    await expect(page.locator('#ownerCodes li')).toHaveCount(4);
    const chiamata = server.counters.calls.find((c) => c.name === 'walletCreateInvites');
    expect(chiamata.data.count).toBe(3);
    expect([...server.store.docs.invites.values()].filter((i) => i.fromOwner && !i.usedBy)).toHaveLength(3);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#ownerCodes li')).toHaveCount(4, { timeout: 15_000 });
    await expect(page.locator('#ownerCodes li:not(.is-used)')).toHaveCount(3);
    await expect(page.locator('#ownerCodes li:not(.is-used) .sn-wallet-invite-state').first()).toHaveText('da dare');
    // Quelli da dare vengono prima di quelli usati.
    await expect(page.locator('#ownerCodes li').first()).not.toHaveClass(/is-used/);
    // Copia al clic.
    await page.locator('#ownerCodes li:not(.is-used) .sn-wallet-code').first().click();
    await expect(page.locator('#ownerCodes li:not(.is-used) .sn-wallet-code').first()).toHaveText('Copiato');

    // Tabella degli utenti.
    const riga = page.locator('#ownerUsers tbody tr.sn-wallet-user');
    await expect(riga).toHaveCount(1);
    const celle = await riga.locator('td').allInnerTexts();
    expect(celle[0]).toBe(u.pseudonym);
    expect(celle[2]).toBe('5.000');          // ricevuti
    expect(celle[3]).toMatch(/0,4 \$/);      // speso, letto da OpenRouter
    expect(celle[5]).toBe('te');             // invitato dall'owner
    // Saldo = tetto meno consumo, in crediti.
    const attesi = Math.floor((server.keys.keys.get(server.keys.hashOf(u.key)).limitUsd - 0.4) / (0.0007 * RATE) + 1e-9);
    expect(celle[1].replace(/\./g, '')).toBe(String(attesi));
    // Registro: la riconciliazione ha confrontato 0,40 $ di righe con 0,40 $ di consumo → ok.
    expect(celle[4]).toBe('ok');

    // Il dettaglio per azione e per giorno si apre al clic sulla riga.
    await riga.click();
    const dettaglio = page.locator('#ownerUsers tbody tr.sn-wallet-user-detail');
    await expect(dettaglio).toBeVisible();
    await expect(dettaglio).toContainText(/Per azione \(2 chiamate\)/);
    await expect(dettaglio).toContainText(/filo_chat/);
    await expect(dettaglio).toContainText(/translate/);
    await expect(dettaglio).toContainText(/Per giorno/);
    await riga.click();
    await expect(dettaglio).toBeHidden();

    // Il clic sullo pseudonimo riempie il regalo.
    await riga.locator('td').first().click();
    await expect(page.locator('#ownerGrantPseudonym')).toHaveValue(u.pseudonym);
    await page.fill('#ownerGrantCredits', '250');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(`+250 crediti a ${u.pseudonym}`, { timeout: 15_000 });
    expect(server.store.docs.wallets.get(u.uid).creditsGranted).toBe(5250);
    await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user td').nth(2)).toHaveText('5.250', { timeout: 15_000 });

    // Pseudonimo inesistente.
    await page.fill('#ownerGrantPseudonym', 'nessuno0000000000'.slice(0, 16));
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/nessun utente con questo pseudonimo/, { timeout: 15_000 });

    // Tetto globale: rifiuto coi numeri.
    server.store.docs.config.maxGrantUsd = 4.5;
    await page.fill('#ownerGrantPseudonym', u.pseudonym);
    await page.fill('#ownerGrantCredits', '1000');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/oltre il tetto globale/, { timeout: 15_000 });
    await expect(page.locator('#ownerMsg')).toContainText(/4,5 \$/);
    expect(server.store.docs.wallets.get(u.uid).creditsGranted).toBe(5250);
    delete server.store.docs.config.maxGrantUsd;

    // OpenRouter rifiuta il tetto: niente cambia, e lo si dice.
    server.keys.flags.patchDown = true;
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/OpenRouter non ha accettato/, { timeout: 15_000 });
    expect(server.store.docs.wallets.get(u.uid).creditsGranted).toBe(5250);
    server.keys.flags.patchDown = false;

    // Esiti delle ultime corse.
    await expect(page.locator('#ownerRuns')).toContainText(/riconciliazione/);
    await server.daily(Date.now() + 86_400_000);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#ownerRuns')).toContainText(/giornaliera .*\(1 quote\)/, { timeout: 15_000 });

    // Nessun uid nella pagina: né dell'utente, né dell'owner.
    const html = await page.content();
    expect(html).not.toContain(u.uid);
    expect(html).not.toContain(OWNER_UID);
    expect(html).not.toMatch(/anon-\d/);
  } finally { await chiudi(filo); }
});

test('l’owner con il portafoglio suo: il regalo alla propria installazione muove anche il saldo in cima', async () => {
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const page = await apriCrediti(filo.openTab);
    // L'owner genera un codice e lo riscatta sulla sua installazione (identità
    // dell'installazione ≠ account Google).
    await page.fill('#ownerInviteCount', '1');
    await page.click('#ownerInvitesBtn');
    await expect(page.locator('#ownerCodes li')).toHaveCount(1, { timeout: 15_000 });
    const code = await page.locator('#ownerCodes li .sn-wallet-code').first().innerText();
    await page.fill('#inviteCode', code);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemMsg')).toContainText(/riscattato/i, { timeout: 15_000 });
    await expect(page.locator('#balance')).toHaveText('5.000');
    // La tabella degli utenti non si aggiorna da sola dopo il riscatto (la
    // vista owner si legge una volta per apertura): si ricarica la pagina.
    const subito = await page.locator('#ownerUsers tbody tr.sn-wallet-user').count();
    { const nota = `righe utenti subito dopo il riscatto dell'owner, senza ricaricare: ${subito}`; test.info().annotations.push({ type: 'nota', description: nota }); console.log('[nota]', nota); }
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(1, { timeout: 15_000 });
    const mio = await page.locator('#ownerUsers tbody tr.sn-wallet-user td').first().innerText();
    await page.fill('#ownerGrantPseudonym', mio);
    await page.fill('#ownerGrantCredits', '100');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/\+100 crediti/, { timeout: 15_000 });
    await expect(page.locator('#balance')).toHaveText('5.100', { timeout: 15_000 });
    await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user td').nth(1)).toHaveText('5.100');
  } finally { await chiudi(filo); }
});

test('la quota giornaliera arriva intera: dopo la giornaliera il saldo mostrato è quello ricevuto, senza consumo', async () => {
  // Rilievo del quinto giro, corretto nello stesso giro: col cambio a cinque
  // decimali il tetto in dollari veniva arrotondato al milionesimo e,
  // riconvertito per difetto, dava un credito in meno (5.199 su 5.200
  // ricevuti). Ora il tetto si arrotonda per eccesso e il giro torna intero.
  // Cambio BCE vero, con cinque decimali, come lo scrive Frankfurter.
  const u = await utenteEsistente('utente-quota');
  server.keys.keys.get(server.keys.hashOf(u.key)).usageUsd = 0;
  const giorno = 86_400_000;
  const s1 = await server.daily(Date.now() + giorno);
  expect(s1.granted).toBe(1);
  const s2 = await server.daily(Date.now() + 2 * giorno);
  expect(s2.granted).toBe(1);
  const st = await server.service.state(u.uid, server.deps);
  expect(st.balance.creditsGranted).toBe(5200);
  // Quello che la pagina Crediti e la tabella dell'owner mostrano come saldo.
  expect(st.balance.credits).toBe(5200);
});

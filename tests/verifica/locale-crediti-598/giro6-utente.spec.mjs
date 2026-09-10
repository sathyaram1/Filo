// Verifica #598, sesto giro — porte nuove sul cammino dell'utente:
// la riga incollata intera, lo
// pseudonimo che l'utente dovrebbe poter dare all'owner, la chiave che arriva
// alle schede già aperte senza riavvio, il codice dato a un amico che risulta
// usato, il saldo che scende dopo il consumo, il deposito della chiave
// corrotto sul disco.
import { test, expect } from '@playwright/test';
import { writeFileSync, rmSync } from 'node:fs';
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

async function riscatta(page, testo) {
  await page.fill('#inviteCode', testo);
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
}

test('la riga incollata intera passa (rilievo di livello zero del quinto giro)', async () => {
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    // Rilievo di livello zero del quinto giro: la riga intera ricevuta per messaggio.
    const [code] = await server.codiciOwner(1);
    const riga = `Codice: ${code.slice(0, 4)}-${code.slice(4)}`;
    await page.fill('#inviteCode', riga);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemMsg')).toContainText(/riscattato/i, { timeout: 15_000 });
    await expect(page.locator('#balance')).toHaveText('5.000');
  } finally { await chiudi(filo); }

  // L'alfabeto dei codici non ha 0, 1, I, L né O: la lettura non è ambigua,
  // e non c'è niente da provare sul «0 per O».
});

test('l’utente può leggere il proprio pseudonimo, quello con cui l’owner gli regala crediti', async () => {
  // Sesto giro: la pagina non lo mostra da nessuna parte. Atteso rosso finché
  // non viene corretto (poi togliere questa riga).
  test.fail(true, 'lo pseudonimo non compare nella pagina Crediti dell’utente');
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    const pseudonym = [...server.store.docs.wallets.values()][0].pseudonym;
    expect(pseudonym).toHaveLength(16);
    // Dopo il riscatto e dopo un ricaricamento: da qualche parte nella pagina
    // (o nel testo, o in un attributo copiabile) lo pseudonimo deve esserci.
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#balance')).toHaveText('5.000', { timeout: 15_000 });
    const html = await page.content();
    const inChat = await (async () => {
      const dash = await filo.openTab('filo://dashboard/dashboard.html');
      await fintoOpenRouter(filo.app, { text: 'Non lo so.' });
      const bolla = await chiediInChat(dash, 'qual è il mio pseudonimo dei crediti?');
      return (await bolla.innerText()).includes(pseudonym);
    })();
    console.log('[nota]', `pseudonimo nella pagina: ${html.includes(pseudonym)}, in chat: ${inChat}`);
    expect(html.includes(pseudonym) || inChat).toBe(true);
  } finally { await chiudi(filo); }
});

test('la chiave arriva alle schede già aperte: home aperta prima del riscatto, poi la chat parte senza riavvio', async () => {
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 15_000 });
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    const key = [...server.keys.keys.values()][0].key;
    await fintoOpenRouter(filo.app, { text: 'Adesso rispondo.' });
    const bolla = await chiediInChat(dash, 'ci sei?');
    await expect(bolla).toContainText(/Adesso rispondo/);
    const calls = await chiamateOpenRouter(filo.app);
    expect(calls.filter((c) => !c.url.endsWith('/models')).length).toBeGreaterThan(0);
    for (const c of calls) expect(c.auth).toBe(`Bearer ${key}`);
    // La home non chiede più l'invito: subito, o al ricaricamento.
    let testo = await dash.locator('#homeMessage').innerText();
    if (/codice d.invito/i.test(testo)) {
      await dash.reload();
      await expect(dash.locator('#homeMessage')).not.toHaveText('…', { timeout: 15_000 });
      testo = await dash.locator('#homeMessage').innerText();
    }
    expect(testo).not.toMatch(/codice d.invito/i);
    await expect(dash.locator('#suggestions .dash-suggestion', { hasText: /Apri Crediti/ })).toHaveCount(0);
  } finally { await chiudi(filo); }
});

test('un codice dato a un amico risulta usato; il saldo scende dopo il consumo; il deposito della chiave corrotto non blocca', async () => {
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  const userData = filo.userData;
  try {
    const page = await apriCrediti(filo.openTab);
    await riscatta(page, code);
    const miei = await page.locator('#invites li .sn-wallet-code').allInnerTexts();
    expect(miei).toHaveLength(3);
    // L'amico riscatta il primo dei miei codici (sul server, come farebbe la sua installazione).
    const amico = await server.service.redeem('anon-amico', miei[0], server.deps);
    expect(amico.status).toBe('ok');
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    await expect(page.locator('#invites li')).toHaveCount(3, { timeout: 15_000 });
    const usato = page.locator('#invites li', { hasText: miei[0].replace('-', '') }).or(page.locator('#invites li', { hasText: miei[0] }));
    await expect(usato.first()).toHaveClass(/is-used/);
    await expect(usato.first().locator('.sn-wallet-invite-state')).toContainText(/usato/i);
    // I posti globali scalano anche per il codice dell'amico.
    // Il consumo: OpenRouter dice che la mia chiave ha speso 0,7 $ → il saldo scende.
    const mia = [...server.store.docs.wallets.values()][0];
    const h = mia.keyHash;
    server.keys.keys.get(h).usageUsd = 0.7;
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('wallet').hidden);
    // Dal ramo -b il saldo mostra il decimo (per difetto) e i 1.000 locali di
    // benvenuto si sommano ai 5.000: si confronta col numero che il server dà.
    const attesi = Math.floor((server.keys.keys.get(h).limitUsd - 0.7) / (0.0007 * RATE) * 10 + 1e-6) / 10;
    const [intero, dec] = String(attesi).split('.');
    await expect(page.locator('#balance')).toHaveText(intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : ''), { timeout: 15_000 });
    expect(attesi).toBeLessThan(mia.creditsGranted);
  } finally { await chiudi(filo); }

  // Il deposito della chiave sul disco è rovinato: al riavvio la pagina offre
  // un'uscita («Richiedi una nuova chiave») invece di un errore muto.
  writeFileSync(join(userData, 'wallet.bin'), Buffer.from('spazzatura-non-cifrata-0123456789'));
  const bis = await avviaFilo({ userData, env: server.env });
  try {
    const page = await apriCrediti(bis.openTab);
    await expect(page.locator('#reissueBtn')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#redeemForm')).toBeHidden();
    await page.click('#reissueBtn');
    await expect(page.locator('#reissueBtn')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#balance')).not.toHaveText('—');
    expect(await bis.app.evaluate(async () => globalThis.SN_WALLET_MAIN.keySource())).toBe('personal');
  } finally { await chiudi(bis); rmSync(userData, { recursive: true, force: true }); }
});

test('il codice incollato in chat, senza chiave: Filo lo riconosce e lo riscatta (la GUI è una scorciatoia, non l’unica strada)', async () => {
  // Sesto giro: senza chiave la chat risponde solo «serve un codice d'invito,
  // Apri Crediti», anche quando il codice è proprio lì nel messaggio. Il
  // riconoscimento non ha bisogno di un modello. Atteso rosso finché non viene
  // corretto (poi togliere questa riga).
  test.fail(true, 'la chat non riscatta il codice scritto nel messaggio');
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    const dash = await filo.openTab('filo://dashboard/dashboard.html');
    await expect(dash.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 15_000 });
    const bolla = await chiediInChat(dash, `ho un codice d'invito: ${code.slice(0, 4)}-${code.slice(4)}`);
    const testo = await bolla.innerText();
    console.log('[nota]', `codice in chat → «${testo.slice(0, 160)}»`);
    // O il riscatto è fatto, o almeno il codice è stato passato alla pagina Crediti.
    const riscattato = server.store.docs.invites.get(code)?.usedBy;
    let precompilato = false;
    const cred = filo.app.windows().find((w) => w.url().startsWith('filo://credits'));
    if (cred) { await cred.waitForLoadState('domcontentloaded').catch(() => {}); precompilato = ((await cred.locator('#inviteCode').inputValue().catch(() => '')) || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === code; }
    expect(Boolean(riscattato) || precompilato).toBe(true);
  } finally { await chiudi(filo); }
});

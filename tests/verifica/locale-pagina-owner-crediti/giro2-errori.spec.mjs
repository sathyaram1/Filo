// Secondo giro — le ALTRE strade in cui il server può rifiutare, sulla stessa
// pagina. Il giro prima ha fatto togliere la risposta tecnica del server da
// sotto le manopole e dalla riga in cima. Restano i due moduli in mezzo alla
// pagina — «Nuovi codici» e «Regala crediti a» — e la scheda di una persona:
// anche lì un rifiuto deve arrivare come frase, non come risposta del server.
import { test, expect } from '@playwright/test';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function ownerPronto() {
  const filo = await avviaFilo({ env: server.env });
  await fintoOpenRouter(filo.app, { fsBase: server.base });
  expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
  return filo;
}

// Le parole che sono del server e non di chi legge.
const TECNICO = /callable|walletCreateInvites|walletGrant|walletUserDetail|INTERNAL|PERMISSION_DENIED|\b(4\d\d|5\d\d)\b|[{}]|fetch failed|ECONN/i;

test('se il server non risponde, «Genera» lo dice con una frase e non con la risposta del server', async () => {
  test.fail(true, 'il modulo dei codici mostra ancora la risposta tecnica del server');
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');

    server.flags.walletDown = true;
    await page.fill('#ownerInviteCount', '3');
    await page.click('#ownerInvitesBtn');
    await expect(page.locator('#ownerMsg')).toBeVisible({ timeout: 20_000 });
    const testo = await page.locator('#ownerMsg').innerText();
    expect(testo.length).toBeGreaterThan(0);
    expect(testo).not.toMatch(TECNICO);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('se il server non risponde, «Regala» lo dice con una frase e non con la risposta del server', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const [code] = await server.codiciOwner(1);
    await server.service.redeem('anon-a', code, server.deps);
    const pa = server.store.docs.wallets.get('anon-a').pseudonym;
    const page = await apriOwner(filo);
    await expect(page.locator('tr.sn-wallet-user', { hasText: pa })).toBeVisible({ timeout: 20_000 });

    server.flags.walletDown = true;
    await page.fill('#ownerGrantPseudonym', pa);
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toBeVisible({ timeout: 20_000 });
    const testo = await page.locator('#ownerMsg').innerText();
    expect(testo.length).toBeGreaterThan(0);
    expect(testo).not.toMatch(TECNICO);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('se la scheda di una persona non arriva, lo dice a parole e si può riprovare', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const [code] = await server.codiciOwner(1);
    await server.service.redeem('anon-a', code, server.deps);
    const pa = server.store.docs.wallets.get('anon-a').pseudonym;
    const page = await apriOwner(filo);
    const riga = page.locator('tr.sn-wallet-user', { hasText: pa });
    await expect(riga).toBeVisible({ timeout: 20_000 });

    server.flags.walletDown = true;
    await riga.click();
    const scheda = page.locator('tr.sn-wallet-user-detail:not([hidden])');
    await expect(scheda.locator('.is-error')).toBeVisible({ timeout: 20_000 });
    const testo = await scheda.innerText();
    expect(testo).not.toMatch(TECNICO);

    // E si deve poter riprovare: tornato il server, riaprendo la scheda arriva.
    server.flags.walletDown = false;
    await riga.click();
    await riga.click();
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])')).toContainText(/saldo|movimenti|ricevuti/i, { timeout: 20_000 });
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un pseudonimo che non esiste non è un guasto: lo dice in italiano', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
    await page.fill('#ownerGrantPseudonym', 'nessuno-qui');
    await page.fill('#ownerGrantCredits', '5');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toBeVisible({ timeout: 20_000 });
    const testo = await page.locator('#ownerMsg').innerText();
    expect(testo).not.toMatch(TECNICO);
    expect(testo).toMatch(/pseudonimo|nessun utente|non risulta/i);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

// Secondo giro — il tasto destro su una persona e i costi piccoli. Il giro
// prima li ha fatti nascere: qui si guarda se le voci del menu FANNO quello
// che promettono, se il menu generale della pagina esiste ancora fuori dalla
// tabella, e se un costo di qualche milionesimo di dollaro si legge davvero.
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

async function unaPersona(spese = []) {
  const [code] = await server.codiciOwner(1);
  await server.service.redeem('anon-a', code, server.deps);
  const pa = server.store.docs.wallets.get('anon-a').pseudonym;
  for (const s of spese) server.store.docs.usage.push({ pseudonym: pa, ...s });
  return pa;
}

const MENU = '.sn-wallet-ctxmenu';

test('le voci del menu di una persona fanno quello che dicono', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const pa = await unaPersona();
    const page = await apriOwner(filo);
    const riga = page.locator('tr.sn-wallet-user', { hasText: pa });
    await expect(riga).toBeVisible({ timeout: 20_000 });

    // «Regala crediti a questa persona»: il modulo del regalo si trova già
    // compilato, senza ricopiare lo pseudonimo a mano.
    await riga.click({ button: 'right' });
    await expect(page.locator(MENU)).toBeVisible({ timeout: 10_000 });
    await page.locator(`${MENU} [role="menuitem"]`, { hasText: /regala/i }).click();
    await expect(page.locator(MENU)).toHaveCount(0);
    expect(await page.inputValue('#ownerGrantPseudonym')).toBe(pa);
    // E il regalo, di seguito, arriva davvero.
    await page.fill('#ownerGrantCredits', '7');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(`+7`, { timeout: 20_000 });

    // «Copia lo pseudonimo»: finisce negli appunti del sistema.
    await filo.app.evaluate(({ clipboard }) => clipboard.writeText('niente'));
    await riga.click({ button: 'right' });
    await expect(page.locator(MENU)).toBeVisible({ timeout: 10_000 });
    await page.locator(`${MENU} [role="menuitem"]`, { hasText: /pseudonimo/i }).click();
    await expect.poll(async () => filo.app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 }).toBe(pa);

    // «Apri la scheda»: la stessa cosa del clic sulla riga.
    await riga.click({ button: 'right' });
    await expect(page.locator(MENU)).toBeVisible({ timeout: 10_000 });
    await page.locator(`${MENU} [role="menuitem"]`, { hasText: /scheda/i }).click();
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])')).toBeVisible({ timeout: 20_000 });

    // Aperta la scheda, la voce cambia: adesso offre di richiuderla.
    await riga.click({ button: 'right' });
    await expect(page.locator(MENU)).toContainText(/chiudi la scheda/i, { timeout: 10_000 });
    // Esc chiude il menu senza fare niente.
    await page.keyboard.press('Escape');
    await expect(page.locator(MENU)).toHaveCount(0);
    await expect(page.locator('tr.sn-wallet-user-detail:not([hidden])')).toBeVisible();
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('due tasti destri di fila lasciano un menu solo', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const pa = await unaPersona();
    const page = await apriOwner(filo);
    const riga = page.locator('tr.sn-wallet-user', { hasText: pa });
    await expect(riga).toBeVisible({ timeout: 20_000 });
    await riga.click({ button: 'right' });
    await riga.click({ button: 'right' });
    await riga.click({ button: 'right' });
    await page.waitForTimeout(800);
    expect(await page.locator(MENU).count()).toBe(1);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('il tasto destro fuori dalla tabella apre ancora il menu della pagina', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    await unaPersona();
    const page = await apriOwner(filo);
    await expect(page.locator('#ownerKnobs input').first()).toBeVisible({ timeout: 20_000 });
    // Un tasto destro sul titolo della pagina: qui il menu è quello generale,
    // e deve esserci ancora.
    await page.locator('#title').click({ button: 'right' });
    await page.waitForTimeout(1500);
    const visto = await page.evaluate(() => {
      const n = document.querySelector('.sn-menu');
      return n ? n.innerText : '';
    });
    expect(visto.length).toBeGreaterThan(0);
    // E non è quello di una persona.
    expect(visto).not.toMatch(/pseudonimo/i);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un costo di qualche milionesimo di dollaro si legge, in tutti e quattro i posti', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const pa = await unaPersona([
      { at: '2026-09-18T10:00:00.000Z', action: 'traduci', model: 'glm-5', servedBy: 'Baseten', promptTokens: 40, completionTokens: 8, costUsd: 0.0000004, credits: 0.1 },
      { at: '2026-09-19T10:00:00.000Z', action: 'spiega', model: 'glm-5', servedBy: 'Baseten', promptTokens: 60, completionTokens: 9, costUsd: 0.0000007, credits: 0.1 },
    ]);
    // Quello che la chiave di quella persona ha speso: la riga «Speso» della
    // scheda viene da lì, non dalla somma delle righe del registro.
    server.store.docs.wallets.get('anon-a').usageUsd = 0.0000011;

    const page = await apriOwner(filo);
    const riga = page.locator('tr.sn-wallet-user', { hasText: pa });
    await expect(riga).toBeVisible({ timeout: 20_000 });
    await riga.click();
    const scheda = page.locator('tr.sn-wallet-user-detail:not([hidden])');
    await expect(scheda).toContainText('traduci', { timeout: 20_000 });
    const testo = await scheda.innerText();
    // Dove si parla di soldi spesi davvero, il costo non si legge «0 $»:
    // in due parole, per azione, per giorno e nelle ultime chiamate.
    const speso = (await scheda.innerText()).split('Dove sono andati')[0];
    expect(speso).toMatch(/Speso\s+0,0000\d+ \$/);
    expect(speso).not.toMatch(/Speso\s+0 \$/);
    expect(testo.split('Dove sono andati')[1] || '').not.toMatch(/(^|\s)0 \$/m);
    expect(testo).toMatch(/traduci/);
    expect(testo).toMatch(/spiega/);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

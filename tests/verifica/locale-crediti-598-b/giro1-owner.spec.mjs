// Verifica del ramo crediti-598-b, primo giro — la parte owner (inviti,
// utenti) in una pagina separata da quella dell'utente.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriCrediti, apriOwner, simulaOwner, cartellaFiloSecurity, APP_ROOT,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

async function chiudi(filo) { try { await filo.app.close(); } catch (_) {} }
const SHOTS = join(APP_ROOT, 'tests', '.shots');

test('owner: la pagina Crediti non ha più i comandi da proprietario, li rimanda a una pagina sua che funziona', async () => {
  test.setTimeout(150_000);
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const page = await apriCrediti(filo.openTab);
    // Niente comandi owner qui.
    expect(await page.locator('#ownerSection, #ownerInvitesForm, #ownerGrantForm, #ownerUsers').count()).toBe(0);
    const link = page.locator('#ownerLink a');
    await expect(link).toBeVisible({ timeout: 15_000 });
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'verifica-598b-crediti-owner.png'), fullPage: true });
    // Il rimando porta alla pagina owner, nella stessa scheda.
    await link.click();
    await page.waitForURL(/owner\.html/, { timeout: 15_000 });
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
    await expect(page).toHaveTitle(/Inviti e utenti/);
    await expect(page.locator('#ownerDenied')).toBeHidden();
    await expect(page.locator('#ownerTotals')).toContainText(/utenti/, { timeout: 15_000 });

    // Genero due codici: compaiono, e il server li ha.
    await page.fill('#ownerInviteCount', '2');
    await page.click('#ownerInvitesBtn');
    await expect(page.locator('#ownerCodes li')).toHaveCount(2, { timeout: 15_000 });
    expect(server.store.docs.invites.size).toBe(2);
    await page.screenshot({ path: join(SHOTS, 'verifica-598b-owner-chiaro.png'), fullPage: true });

    // Un utente riscatta uno dei codici: la tabella ha una riga, e il regalo funziona.
    const code = (await page.locator('#ownerCodes li .sn-wallet-code').first().innerText()).replace('-', '');
    const u = await server.service.redeem('anon-utente', code, server.deps);
    expect(u.status).toBe('ok');
    await page.reload();
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
    await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('#ownerCodes li.is-used')).toHaveCount(1);
    const pseudonym = server.store.docs.wallets.get('anon-utente').pseudonym;
    await page.fill('#ownerGrantPseudonym', pseudonym);
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/\+10 crediti/, { timeout: 15_000 });
    await expect.poll(() => server.store.docs.wallets.get('anon-utente').creditsGranted, { timeout: 15_000 }).toBe(5010);
    await expect(page.locator('#ownerUsers tbody tr.sn-wallet-user td').nth(1)).toHaveText('5.010', { timeout: 15_000 });

    // Il rimando indietro riporta ai Crediti.
    await page.click('text=← Crediti');
    await page.waitForURL(/credits\.html/, { timeout: 15_000 });
    await page.waitForFunction(() => !document.getElementById('wallet').hidden, null, { timeout: 15_000 });

    // Tema scuro della pagina owner.
    await filo.app.evaluate(async () => {
      const s = await globalThis.SN_STORAGE.getSettings();
      await globalThis.SN_STORAGE.saveSettings({ ...s, theme: 'dark' });
    });
    const dark = await apriOwner(filo);
    await dark.waitForTimeout(500);
    await dark.screenshot({ path: join(SHOTS, 'verifica-598b-owner-scuro.png'), fullPage: true });
  } finally { await chiudi(filo); }
});

test('non owner: nessun rimando nei Crediti, e la pagina owner aperta a mano non mostra niente', async () => {
  const filo = await avviaFilo({ env: server.env });
  try {
    const page = await apriCrediti(filo.openTab);
    await expect(page.locator('#ownerLink')).toBeHidden();
    const owner = await apriOwner(filo);
    await expect(owner.locator('#ownerDenied')).toBeVisible();
    await expect(owner.locator('#ownerSection')).toBeHidden();
    // Nemmeno via messaggio: la vista owner è negata.
    const r = await filo.app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'wallet_owner_overview' }, { isShell: true }, 'filo://credits'));
    expect(r && r.ok).toBeFalsy();
    expect(server.counters.calls.filter((c) => c.name === 'walletOverview').length).toBe(0);
  } finally { await chiudi(filo); }
});

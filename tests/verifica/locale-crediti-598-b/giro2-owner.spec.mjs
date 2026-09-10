// Verifica del ramo crediti-598-b, secondo giro — la pagina «Inviti e utenti».
// Riprova le porte del primo giro (riga dei totali prima del primo utente,
// moduli su una riga a 1.600 pixel) e stressa i due moduli con input limite.
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

async function finestra(filo, w, h) {
  await filo.app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(w, h);
  }, [w, h]);
}

// Le righe (coordinata y) occupate dai figli visibili di un modulo.
async function righeDelModulo(page, sel) {
  return page.$$eval(`${sel} > *`, (els) => {
    // Il centro verticale, non il bordo alto: etichetta e campo hanno altezze
    // diverse e su una stessa riga (allineati al centro) i bordi alti differiscono.
    const ys = els.filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.height / 2) / 10); });
    return [...new Set(ys)].length;
  });
}

test('owner, prima del primo utente: la riga dei totali ha tutti i numeri, i moduli stanno su una riga a 1.600 pixel, e reggono input strani', async () => {
  test.setTimeout(150_000);
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    await finestra(filo, 1600, 900);
    const page = await apriOwner(filo);
    await expect(page.locator('#ownerSection')).toBeVisible();
    await expect(page.locator('#ownerTotals')).toContainText(/utenti/, { timeout: 15_000 });
    const totali = await page.locator('#ownerTotals').innerText();
    console.log('[nota]', `totali prima del primo utente: «${totali}»`);
    expect(totali).not.toMatch(/—/);
    expect(totali).not.toMatch(/cambio mancante/);
    expect(totali).toMatch(/0 utenti/);
    expect(totali).toMatch(/tetti 0 \$ su 50 \$/);
    expect(totali).toMatch(/cambio 1,?16871|cambio 1\.16871/);

    // I due moduli: etichetta, campo/i e bottone sulla stessa riga.
    await page.waitForTimeout(300);
    const righeInviti = await righeDelModulo(page, '#ownerInvitesForm');
    const righeRegalo = await righeDelModulo(page, '#ownerGrantForm');
    const box1 = await page.locator('#ownerInvitesForm').boundingBox();
    const box2 = await page.locator('#ownerGrantForm').boundingBox();
    console.log('[nota]', `a 1.600 px: modulo codici su ${righeInviti} riga/e, modulo regalo su ${righeRegalo} riga/e; i due moduli affiancati: ${Math.abs(box1.y - box2.y) < 4}`);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'verifica-598b-giro2-owner-1600.png'), fullPage: true });
    expect(righeInviti).toBe(1);
    expect(righeRegalo).toBe(1);

    // Input strani sul modulo dei codici: «abc» e 0 non mandano richieste assurde.
    // Con 0 nel campo il modulo non parte: il campo è segnato non valido dal
    // browser (min=1) e al server non arriva niente.
    await page.fill('#ownerInviteCount', '0');
    await page.click('#ownerInvitesBtn');
    await page.waitForTimeout(800);
    const invalido = await page.$eval('#ownerInviteCount', (e) => e.matches(':invalid'));
    console.log('[nota]', `con 0 nel campo: ${server.store.docs.invites.size} codici generati, campo non valido: ${invalido}`);
    expect(server.store.docs.invites.size).toBe(0);
    expect(invalido).toBe(true);
    // Con 2: due codici.
    await page.fill('#ownerInviteCount', '2');
    await page.click('#ownerInvitesBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/2 codici nuovi/, { timeout: 15_000 });
    expect(server.store.docs.invites.size).toBe(2);
    // Doppio clic rapido: non due lotti.
    await page.fill('#ownerInviteCount', '1');
    const prima = server.store.docs.invites.size;
    await page.dblclick('#ownerInvitesBtn');
    await page.waitForTimeout(2000);
    const dopo = server.store.docs.invites.size;
    console.log('[nota]', `doppio clic su Genera con 1: ${dopo - prima} codici`);
    expect(dopo - prima).toBeLessThanOrEqual(1);

    // Regalo a uno pseudonimo che non esiste, con HTML dentro: rifiuto spiegato, niente markup.
    await page.fill('#ownerGrantPseudonym', '<b>x</b>');
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/nessun utente/, { timeout: 15_000 });
    expect(await page.locator('#ownerMsg b').count()).toBe(0);
    // Regalo con 0 crediti: nessuna chiamata al server.
    const chiamatePrima = server.counters.calls.filter((c) => c.name === 'walletGrant').length;
    await page.fill('#ownerGrantCredits', '0');
    await page.click('#ownerGrantBtn');
    await page.waitForTimeout(800);
    expect(server.counters.calls.filter((c) => c.name === 'walletGrant').length).toBe(chiamatePrima);

    // Un utente entra; il regalo con decimali diventa intero, e la tabella lo mostra.
    const code = [...server.store.docs.invites.keys()][0];
    const u = await server.service.redeem('anon-utente', code, server.deps, { localCredits: 700 });
    expect(u.status).toBe('ok');
    await page.reload();
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
    const riga = page.locator('#ownerUsers tbody tr.sn-wallet-user');
    await expect(riga).toHaveCount(1, { timeout: 15_000 });
    await expect(riga.locator('td').nth(2)).toHaveText('5.700');
    const pseudonym = server.store.docs.wallets.get('anon-utente').pseudonym;
    // Il clic sullo pseudonimo lo mette nel campo del regalo.
    await riga.locator('td').first().click();
    await expect(page.locator('#ownerGrantPseudonym')).toHaveValue(pseudonym);
    // Un decimale nel campo dei crediti: il browser lo segna non valido (passo 1) e non parte niente.
    await page.fill('#ownerGrantCredits', '10.7');
    await page.click('#ownerGrantBtn');
    await page.waitForTimeout(800);
    const decimaleInvalido = await page.$eval('#ownerGrantCredits', (e) => e.matches(':invalid'));
    console.log('[nota]', `10,7 crediti nel campo del regalo: campo non valido ${decimaleInvalido}, concessi ${server.store.docs.wallets.get('anon-utente').creditsGranted}`);
    expect(server.store.docs.wallets.get('anon-utente').creditsGranted).toBe(5700);
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/\+10 crediti/, { timeout: 15_000 });
    await expect(riga.locator('td').nth(2)).toHaveText('5.710', { timeout: 15_000 });
    const totaliDopo = await page.locator('#ownerTotals').innerText();
    console.log('[nota]', `totali con un utente: «${totaliDopo}»`);
    // Il giro aveva letto «1 utenti» e lo ha segnato come rilievo: da allora si conta al singolare.
    expect(totaliDopo).toMatch(/\b1 utente\b/);
    expect(totaliDopo).not.toMatch(/tetti 0 \$/);
  } finally { await chiudi(filo); }
});

test('owner con il suo portafoglio: la pagina Crediti tiene solo il rimando, e un regalo a sé fatto dall’altra pagina muove il saldo senza ricaricare', async () => {
  test.setTimeout(150_000);
  const [code] = await server.codiciOwner(1);
  const filo = await avviaFilo({ env: server.env });
  try {
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const crediti = await apriCrediti(filo.openTab);
    await crediti.fill('#inviteCode', code);
    await crediti.click('#redeemBtn');
    await expect(crediti.locator('#redeemForm')).toBeHidden({ timeout: 15_000 });
    const saldo = await crediti.locator('#balance').innerText();
    await expect(crediti.locator('#ownerLink a')).toBeVisible();
    expect(await crediti.locator('#ownerSection, #ownerGrantForm, #ownerInvitesForm').count()).toBe(0);

    const owner = await apriOwner(filo);
    await expect(owner.locator('#ownerUsers tbody tr.sn-wallet-user')).toHaveCount(1, { timeout: 15_000 });
    const mio = [...server.store.docs.wallets.values()][0].pseudonym;
    await owner.fill('#ownerGrantPseudonym', mio);
    await owner.fill('#ownerGrantCredits', '25');
    await owner.click('#ownerGrantBtn');
    await expect(owner.locator('#ownerMsg')).toContainText(/\+25 crediti/, { timeout: 15_000 });
    const attesoNum = Number(saldo.replace(/\./g, '').replace(',', '.')) + 25;
    const v = Math.round(attesoNum * 10) / 10;
    const [int, dec] = String(v).split('.');
    const atteso = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dec ? ',' + dec : '');
    await expect(crediti.locator('#balance')).toHaveText(atteso, { timeout: 15_000 });
    console.log('[nota]', `saldo owner ${saldo} → dopo il regalo a sé ${await crediti.locator('#balance').innerText()}`);
  } finally { await chiudi(filo); }
});

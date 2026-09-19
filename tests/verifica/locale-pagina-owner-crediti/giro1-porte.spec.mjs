// Primo giro — le porte laterali: chi non è l'owner, il server che non
// risponde, testo ostile nei campi, e la manopola degli inviti per persona.
import { test, expect } from '@playwright/test';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity,
} from './helpers/banco.mjs';

test.skip(!cartellaFiloSecurity(), 'filo-security non è accanto al repo: il server dei crediti non si può far girare');

let server;
test.beforeEach(async () => { server = await avviaServer(); });
test.afterEach(async () => { await server.chiudi(); });

test('chi non è l’owner non vede i numeri e non riesce a cambiarli nemmeno di nascosto', async () => {
  test.setTimeout(240_000);
  const filo = await avviaFilo({ env: server.env });
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    const page = await apriOwner(filo); // senza simulaOwner: è una persona qualunque
    await expect(page.locator('#ownerDenied')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#ownerSection')).toBeHidden();
    expect(await page.locator('#ownerKnobs input').count()).toBe(0);

    // E chiedendolo direttamente, senza passare dai campi: rifiutato, e niente
    // è cambiato nel documento da cui il server legge.
    const esito = await page.evaluate(async () => {
      const fuori = [];
      for (const t of ['wallet_owner_knobs_set', 'wallet_owner_overview', 'wallet_owner_user_detail', 'wallet_owner_grant']) {
        try {
          fuori.push(await chrome.runtime.sendMessage({ type: t, patch: { entryCredits: 999999 }, pseudonym: 'chiunque', credits: 9999 }));
        } catch (e) { fuori.push({ errore: String((e && e.message) || e) }); }
      }
      return fuori;
    }).catch((e) => [{ errore: String(e) }]);
    for (const r of esito) expect(JSON.stringify(r)).not.toMatch(/"ok":true/);
    expect(server.store.docs.config.entryCredits).toBeUndefined();
    expect((await server.configEffettiva()).entryCredits).toBe(5000);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('gli inviti per persona sono una manopola: a zero chi entra non riceve codici', async () => {
  test.setTimeout(240_000);
  const filo = await avviaFilo({ env: server.env });
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-invitesPerUser'), { timeout: 20_000 }).toBe('3');

    await page.fill('#knob-invitesPerUser', '0');
    await page.click('#knob-invitesPerUser-salva');
    await expect(page.locator('#knob-invitesPerUser-msg')).toContainText('Salvato', { timeout: 20_000 });

    const [code] = await server.codiciOwner(1);
    expect((await server.service.redeem('anon-z', code, server.deps)).status).toBe('ok');
    const suoi = await server.store.listInvitesOf('anon-z');
    expect(suoi.length).toBe(0);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un nome ostile nel campo del regalo resta testo, e non diventa parte della pagina', async () => {
  test.setTimeout(240_000);
  const filo = await avviaFilo({ env: server.env });
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    const page = await apriOwner(filo);
    await expect(page.locator('#ownerNumeri')).toContainText('utent', { timeout: 20_000 });

    await page.fill('#ownerGrantPseudonym', '<img src=x onerror="document.title=\'preso\'">');
    await page.fill('#ownerGrantCredits', '5');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toBeVisible({ timeout: 20_000 });
    expect(await page.title()).not.toBe('preso');
    expect(await page.locator('#ownerMsg img').count()).toBe(0);
    expect(await page.locator('main img[src="x"]').count()).toBe(0);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('col server giù la pagina lo dice, invece di restare muta', async () => {
  test.setTimeout(240_000);
  const filo = await avviaFilo({ env: server.env });
  try {
    await fintoOpenRouter(filo.app, { fsBase: server.base });
    expect((await simulaOwner(filo.app, server)).isAdmin).toBe(true);
    server.flags.walletDown = true;
    const page = await apriOwner(filo);
    // Qualcosa deve comparire: un avviso, non una pagina vuota e ferma.
    await page.waitForTimeout(8000);
    // eslint-disable-next-line no-console
    console.log('PAGINA COL SERVER GIÙ >>>\n' + (await page.locator('main').innerText()) + '\n<<<');
    await expect.poll(async () => {
      const t = await page.locator('main').innerText();
      return /non (si|è)|errore|riprova|non raggiungibile|più tardi/i.test(t);
    }, { timeout: 20_000 }).toBe(true);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

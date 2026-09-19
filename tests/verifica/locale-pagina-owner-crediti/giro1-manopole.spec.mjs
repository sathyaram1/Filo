// Primo giro di verifica della pagina dell'owner dei crediti.
//
// Quello che l'owner ha chiesto: nella sua pagina vuole i numeri dei crediti —
// tetto massimo elargibile, crediti vivi, persone per invito, ingresso, quota
// del giorno, premi dei feedback — e vuole poterli CAMBIARE, tranne quelli che
// si calcolano da soli. Qui si prova che cambiarli cambia davvero quello che
// il server fa, non solo quello che la pagina scrive.
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
const valoreManopola = (page, chiave) => page.inputValue(`#knob-${chiave}`);

test('le sette manopole nascono col valore in vigore, si salvano, e il server ubbidisce', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);

    // Il valore in vigore si legge nel campo: senza, l'owner cambierebbe un
    // numero senza sapere da cosa parte.
    await expect.poll(() => valoreManopola(page, 'entryCredits'), { timeout: 20_000 }).toBe('5000');
    expect(await valoreManopola(page, 'dailyCredits')).toBe('100');
    expect(await valoreManopola(page, 'invitesPerUser')).toBe('3');
    expect(await valoreManopola(page, 'invitesMaxUses')).toBe('3');
    expect(await valoreManopola(page, 'rewardFeedbackSent')).toBe('10');
    expect(await valoreManopola(page, 'rewardFeedbackClosed')).toBe('50');
    expect(Number(await valoreManopola(page, 'maxGrantCredits'))).toBeGreaterThan(0);

    // Crediti a chi entra: 777. Chi entra dopo ne riceve 777.
    await page.fill('#knob-entryCredits', '777');
    await page.click('#knob-entryCredits-salva');
    await expect(page.locator('#knob-entryCredits-msg')).toContainText('Salvato', { timeout: 20_000 });
    const [c1, c2] = await server.codiciOwner(2);
    const entrato = await server.service.redeem('anon-nuovo', c1, server.deps);
    expect(entrato.status).toBe('ok');
    expect(entrato.credits).toBe(777);

    // Premio per un feedback inviato: 42. Il premio pagato è 42.
    await page.fill('#knob-rewardFeedbackSent', '42');
    await page.click('#knob-rewardFeedbackSent-salva');
    await expect(page.locator('#knob-rewardFeedbackSent-msg')).toContainText('Salvato', { timeout: 20_000 });
    const pseudo = server.store.docs.wallets.get('anon-nuovo').pseudonym;
    const premio = await server.premio({ feedbackId: 'fb-1', pseudonym: pseudo, kind: 'sent' });
    expect(premio.ok).toBe(true);
    expect(server.store.docs.wallets.get('anon-nuovo').credits).toBe(777 + 42);

    // Persone per invito: 1. Vale anche per un codice già in giro.
    await page.fill('#knob-invitesMaxUses', '1');
    await page.click('#knob-invitesMaxUses-salva');
    await expect(page.locator('#knob-invitesMaxUses-msg')).toContainText('Salvato', { timeout: 20_000 });
    expect((await server.service.redeem('anon-x', c2, server.deps)).status).toBe('ok');
    expect((await server.service.redeem('anon-y', c2, server.deps)).status).toBe('code_used');

    // Quota del giorno: 9. Domani arrivano 9 crediti a testa.
    await page.fill('#knob-dailyCredits', '9');
    await page.click('#knob-dailyCredits-salva');
    await expect(page.locator('#knob-dailyCredits-msg')).toContainText('Salvato', { timeout: 20_000 });
    const prima = server.store.docs.wallets.get('anon-x').credits;
    await server.daily(Date.now() + 86_400_000);
    expect(server.store.docs.wallets.get('anon-x').credits).toBe(prima + 9);

    // Riaprendo la pagina i numeri salvati sono quelli.
    await page.reload();
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 20_000 });
    await expect.poll(() => valoreManopola(page, 'entryCredits'), { timeout: 20_000 }).toBe('777');
    expect(await valoreManopola(page, 'dailyCredits')).toBe('9');
    expect(await valoreManopola(page, 'invitesMaxUses')).toBe('1');
    expect(await valoreManopola(page, 'rewardFeedbackSent')).toBe('42');
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un numero storto non arriva al server, e lo dice con parole di Filo', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => valoreManopola(page, 'dailyCredits'), { timeout: 20_000 }).toBe('100');

    const storti = [
      ['dailyCredits', '', /numero/i],
      ['dailyCredits', '   ', /numero/i],
      ['dailyCredits', '-5', /negativ/i],
      ['dailyCredits', '3.5', /intero/i],
      ['dailyCredits', '2000000', /massimo/i],
      ['invitesMaxUses', '0', /almeno 1/i],
    ];
    for (const [chiave, valore, atteso] of storti) {
      await page.fill(`#knob-${chiave}`, valore);
      await page.click(`#knob-${chiave}-salva`);
      await expect(page.locator(`#knob-${chiave}-msg`)).toContainText(atteso, { timeout: 15_000 });
      // Niente è arrivato al documento da cui il server legge.
      expect(server.store.docs.config[chiave]).toBeUndefined();
    }
    // E la quota del giorno è ancora quella di prima.
    expect((await server.configEffettiva()).dailyCredits).toBe(100);

    // Un numero lunghissimo incollato non fa passare niente.
    await page.fill('#knob-dailyCredits', '9'.repeat(10_000));
    await page.click('#knob-dailyCredits-salva');
    await expect(page.locator('#knob-dailyCredits-msg')).toBeVisible({ timeout: 15_000 });
    expect(server.store.docs.config.dailyCredits).toBeUndefined();

    // Due clic di fila su Salva non scrivono due volte un valore buono.
    await page.fill('#knob-dailyCredits', '55');
    await Promise.all([
      page.click('#knob-dailyCredits-salva'),
      page.click('#knob-dailyCredits-salva'),
    ]);
    await expect(page.locator('#knob-dailyCredits-msg')).toContainText(/Salvato|già così/i, { timeout: 20_000 });
    expect((await server.configEffettiva()).dailyCredits).toBe(55);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('il tetto dei crediti elargibili ferma OGNI strada: ingresso, quota, regalo e premi', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    const codes = await server.codiciOwner(3);
    expect((await server.service.redeem('anon-a', codes[0], server.deps)).status).toBe('ok');
    const pseudo = server.store.docs.wallets.get('anon-a').pseudonym;

    // Il tetto scende sotto quanto è già stato dato.
    await page.fill('#knob-maxGrantCredits', '1');
    await page.click('#knob-maxGrantCredits-salva');
    await expect(page.locator('#knob-maxGrantCredits-msg')).toContainText('Salvato', { timeout: 20_000 });

    // 1. Chi entra adesso non riceve crediti.
    expect((await server.service.redeem('anon-b', codes[1], server.deps)).status).toBe('global_cap');
    // 2. La quota del giorno non parte.
    const giro = await server.daily(Date.now() + 86_400_000);
    expect(giro.granted).toBe(0);
    expect(giro.refused).toBeGreaterThan(0);
    // 3. Il premio di un feedback non si paga.
    const premio = await server.premio({ feedbackId: 'fb-tetto', pseudonym: pseudo, kind: 'closed' });
    expect(premio.ok).toBe(false);
    // 4. Nemmeno il regalo a mano dell'owner passa, e la pagina lo dice.
    const saldoPrima = server.store.docs.wallets.get('anon-a').credits;
    await page.fill('#ownerGrantPseudonym', pseudo);
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/tetto/i, { timeout: 20_000 });
    expect(server.store.docs.wallets.get('anon-a').credits).toBe(saldoPrima);

    // Rialzato il tetto, il regalo torna a passare: il tetto è una manopola,
    // non un muro definitivo.
    await page.fill('#knob-maxGrantCredits', '1000000');
    await page.click('#knob-maxGrantCredits-salva');
    await expect(page.locator('#knob-maxGrantCredits-msg')).toContainText('Salvato', { timeout: 20_000 });
    await page.fill('#ownerGrantPseudonym', pseudo);
    await page.fill('#ownerGrantCredits', '10');
    await page.click('#ownerGrantBtn');
    await expect(page.locator('#ownerMsg')).toContainText(/\+10/, { timeout: 20_000 });
    expect(server.store.docs.wallets.get('anon-a').credits).toBe(saldoPrima + 10);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

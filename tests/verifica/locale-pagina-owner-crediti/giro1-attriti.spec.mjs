// Primo giro — le prove che riproducono i rilievi della critica.
//
// Erano attese rosse: ognuna falliva per il suo difetto. Corretti tutti e sei
// nello stesso giro, sono diventate verdi e restano qui come memoria: se una
// di queste porte si riapre, il giro dopo la trova senza doverla ricercare.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  avviaServer, avviaFilo, apriOwner, simulaOwner, fintoOpenRouter, cartellaFiloSecurity,
  APP_ROOT,
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

test('un numero scritto e non salvato si vede che non è in vigore', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');

    // Scrivo 500 e il cursore lascia il campo, senza premere Salva.
    await page.fill('#knob-dailyCredits', '500');
    await page.locator('#knob-entryCredits').click();
    await page.waitForTimeout(2000);

    // O il numero è partito, o la pagina dice che non è ancora in vigore.
    const partito = (await server.configEffettiva()).dailyCredits === 500;
    const avvisata = await page.evaluate(() => {
      const box = document.querySelector('.sn-manopola[data-chiave="dailyCredits"]');
      const msg = document.getElementById('knob-dailyCredits-msg');
      const segno = box && box.className !== 'sn-manopola';
      const detto = msg && !msg.hidden && /salva|non .* vigore|in sospeso/i.test(msg.textContent || '');
      return Boolean(segno || detto);
    });
    expect(partito || avvisata).toBe(true);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un numero scritto e non salvato non sparisce senza dirlo quando si torna sulla pagina', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
    await page.fill('#knob-dailyCredits', '500');
    // Salvo un'ALTRA manopola: un gesto naturale, e quello scritto accanto
    // dovrebbe partire con lui o essere segnalato.
    await page.fill('#knob-entryCredits', '4000');
    await page.click('#knob-entryCredits-salva');
    await expect(page.locator('#knob-entryCredits-msg')).toContainText('Salvato', { timeout: 20_000 });
    await page.reload();
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 20_000 });
    await expect.poll(() => page.inputValue('#knob-entryCredits'), { timeout: 20_000 }).toBe('4000');
    expect((await server.configEffettiva()).dailyCredits).toBe(500);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un salvataggio rifiutato dal server si spiega a parole, non col codice dell’errore', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
    server.flags.fsDenied = true;
    await page.fill('#knob-dailyCredits', '200');
    await page.click('#knob-dailyCredits-salva');
    await expect(page.locator('#knob-dailyCredits-msg')).toBeVisible({ timeout: 20_000 });
    const testo = await page.locator('#knob-dailyCredits-msg').innerText();
    expect(testo).toMatch(/non salvato/i);
    expect(testo).not.toMatch(/[{}]|403|PERMISSION_DENIED|config update/i);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('col server irraggiungibile l’avviso è una frase, e «Quanto vale cosa» non resta un titolo vuoto', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    server.flags.walletDown = true;
    const page = await apriOwner(filo);
    await expect.poll(async () => (await page.locator('main').innerText()).length > 0, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(5000);
    const testo = await page.locator('main').innerText();
    expect(testo).not.toMatch(/callable|500|walletOverview/i);
    // Il titolo delle manopole o ha i suoi campi, o non c'è.
    const titolo = await page.locator('#ownerKnobsTitle').isVisible();
    const campi = await page.locator('#ownerKnobs input').count();
    expect(!titolo || campi > 0).toBe(true);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('dopo un salvataggio rifiutato non compare «Rimetti com’era»: non c’è niente da rimettere', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
    server.flags.fsDenied = true;
    await page.fill('#knob-dailyCredits', '200');
    await page.click('#knob-dailyCredits-salva');
    await expect(page.locator('#knob-dailyCredits-msg')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#knob-dailyCredits-rimetti')).toBeHidden();
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('il costo di una chiamata vera non si legge «0 $»', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const [code] = await server.codiciOwner(1);
    await server.service.redeem('anon-a', code, server.deps);
    const pa = server.store.docs.wallets.get('anon-a').pseudonym;
    // Il costo di una chat vera, non un numero inventato.
    server.store.docs.usage.push(
      { pseudonym: pa, at: '2026-09-19T11:00:00.000Z', action: 'chat', model: 'glm-5', servedBy: 'Baseten', promptTokens: 900, completionTokens: 120, costUsd: 0.0031, credits: 4 },
    );
    const page = await apriOwner(filo);
    const riga = page.locator('tr.sn-wallet-user', { hasText: pa });
    await expect(riga).toBeVisible({ timeout: 20_000 });
    await riga.click();
    const scheda = page.locator('tr.sn-wallet-user-detail:not([hidden])');
    await expect(scheda).toContainText('chat', { timeout: 20_000 });
    // Quella chiamata è costata qualcosa: dove si parla di lei il costo non
    // può essere zero (uno zero vero, dove non si è speso niente, resta «0 $»).
    const dove = await scheda.evaluate((el) => {
      const blocchi = [...el.querySelectorAll('.sn-wallet-scheda-blocco')]
        .filter((b) => /Dove sono andati i crediti|Ultime chiamate/.test(b.querySelector('h4')?.textContent || ''));
      return blocchi.map((b) => b.innerText).join('\n');
    });
    expect(dove).not.toMatch(/(^|\s)0 \$/m);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('il tasto destro su una persona offre qualcosa di quella persona', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const [code] = await server.codiciOwner(1);
    await server.service.redeem('anon-a', code, server.deps);
    const pa = server.store.docs.wallets.get('anon-a').pseudonym;
    const page = await apriOwner(filo);
    const riga = page.locator('tr.sn-wallet-user', { hasText: pa });
    await expect(riga).toBeVisible({ timeout: 20_000 });
    await riga.click({ button: 'right' });
    await page.waitForTimeout(1500);
    const voci = await page.evaluate(() => {
      const menu = document.querySelector('.sn-wallet-ctxmenu, .sn-ctx, .sn-context-menu, [class*="ctx-menu"], [class*="context-menu"]');
      return menu ? menu.innerText : '';
    });
    expect(voci).toMatch(/pseudonimo|regala|crediti|scheda|spesa|invit/i);
    // Guardato a occhio, in tutti e due i temi: il menu e il campo con un
    // numero non ancora partito.
    mkdirSync(join(APP_ROOT, 'tests', '.shots'), { recursive: true });
    for (const tema of ['light', 'dark']) {
      await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
      await page.fill('#knob-dailyCredits', '123');
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(APP_ROOT, 'tests', '.shots', `verifica-owner-menu-${tema}.png`) });
    }
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

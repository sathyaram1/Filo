// Secondo giro — le STRADE PER USCIRE da un campo con un numero appena
// scritto. Il giro prima ha fatto chiudere la porta «scritto e non salvato»:
// adesso il numero parte da solo quando il cursore lascia il campo. Qui si
// contano le altre uscite, quelle in cui il cursore NON va su un altro campo
// ma la pagina se ne va: ricarica, collegamento alla pagina Crediti, chiusura
// della scheda. Se il numero sparisce lì, la porta è socchiusa, non chiusa.
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

// Scrive il numero nel campo e lascia il cursore dentro: è la condizione di
// tutte le uscite qui sotto.
async function scriviRestandoDentro(page, chiave, numero) {
  await page.fill(`#knob-${chiave}`, String(numero));
  expect(await page.evaluate((c) => document.activeElement && document.activeElement.id === `knob-${c}`, chiave)).toBe(true);
}

test('un numero scritto non si perde se la pagina viene ricaricata col cursore ancora dentro', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
    await scriviRestandoDentro(page, 'dailyCredits', 500);

    await page.reload();
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 20_000 });
    await page.waitForTimeout(1500);

    // O il numero è andato al server, o la pagina lo ha ancora in mano. Quello
    // che non si può fare è buttarlo via in silenzio.
    const partito = (await server.configEffettiva()).dailyCredits === 500;
    const ancoraLi = (await page.inputValue('#knob-dailyCredits')) === '500';
    expect(partito || ancoraLi).toBe(true);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un numero scritto parte anche seguendo il collegamento alla pagina Crediti', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
    await scriviRestandoDentro(page, 'dailyCredits', 500);

    // Il gesto: scritto il numero, si clicca «← Crediti» per andarsene.
    await page.click('a[href="credits.html"]');
    await page.waitForTimeout(4000);
    expect((await server.configEffettiva()).dailyCredits).toBe(500);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un numero scritto non si perde chiudendo la scheda', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
    await scriviRestandoDentro(page, 'dailyCredits', 500);

    // Il gesto più comune di tutti: messo il numero, si chiude la scheda.
    const chiusa = await filo.shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      const lista = Array.isArray(snap) ? snap : (snap && snap.tabs) || [];
      const t = lista.find((x) => String(x.url || '').includes('owner.html'));
      if (!t) return false;
      await window.filoShell.tabs.close(t.id);
      return true;
    });
    expect(chiusa).toBe(true);
    await new Promise((r) => setTimeout(r, 4000));
    expect((await server.configEffettiva()).dailyCredits).toBe(500);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('il numero partito da solo si può rimettere com’era, senza aver premuto Salva', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
    await scriviRestandoDentro(page, 'dailyCredits', 500);
    // Il cursore va su un altro campo: il numero parte da solo.
    await page.locator('#knob-entryCredits').click();
    await expect.poll(async () => (await server.configEffettiva()).dailyCredits, { timeout: 20_000 }).toBe(500);

    // Se si può cambiare, si deve poter tornare indietro: il tasto c'è ed è
    // quello che rimette il valore di prima, anche sul server.
    const rimetti = page.locator('#knob-dailyCredits-rimetti');
    await expect(rimetti).toBeVisible({ timeout: 20_000 });
    await rimetti.click();
    await expect.poll(async () => (await server.configEffettiva()).dailyCredits, { timeout: 20_000 }).toBe(100);
    await expect.poll(() => page.inputValue('#knob-dailyCredits'), { timeout: 20_000 }).toBe('100');
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

test('un numero storto lasciato nel campo non arriva al server, e la pagina lo dice', async () => {
  test.setTimeout(240_000);
  const filo = await ownerPronto();
  try {
    const page = await apriOwner(filo);
    const prima = await page.inputValue('#knob-invitesMaxUses');
    expect(Number(prima)).toBeGreaterThan(0);
    // Zero dove il minimo è uno: il cursore se ne va senza premere niente.
    await scriviRestandoDentro(page, 'invitesMaxUses', 0);
    await page.locator('#knob-entryCredits').click();
    await page.waitForTimeout(2500);
    expect((await server.configEffettiva()).invitesMaxUses).not.toBe(0);
    const msg = page.locator('#knob-invitesMaxUses-msg');
    await expect(msg).toBeVisible();
    expect(await msg.innerText()).toMatch(/almeno 1|non può|minimo/i);
  } finally {
    try { await filo.app.close(); } catch (_) {}
  }
});

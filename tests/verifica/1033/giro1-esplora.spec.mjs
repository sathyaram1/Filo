// Esplorazione del verificatore #1033, giro 1.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

const A = {
  _id: 'fb-a', text: 'Il pulsante X non funziona.', name: 'Pulsante X',
  seq: 2001, subSeq: 0, status: 'design', statusReason: 'clarify',
  notes: '--- Filo ---\nQuale pulsante X intendi? Non lo trovo.\n\n**A.** Quello in alto.\n**B.** Quello in basso.',
  clientId: 'tester@example.com', createdAt: '2026-10-05T10:00:00Z', images: [],
};
const B = {
  _id: 'fb-b', text: 'Menu stretto.', name: 'Menu stretto',
  seq: 2002, subSeq: 0, status: 'design', statusReason: 'clarify',
  notes: '--- Filo ---\nQuale menu?',
  clientId: 'tester@example.com', createdAt: '2026-10-05T10:00:00Z', images: [],
};
const DEC = {
  _id: 'fb-dec', text: 'Colori.', name: 'Colori',
  seq: 2003, subSeq: 0, status: 'design', statusReason: 'decisione',
  notes: '--- Filo ---\nCaldo o freddo?',
  clientId: 'tester@example.com', createdAt: '2026-10-05T10:00:00Z', images: [],
  livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', at: '2026-10-05T11:00:00Z', testo: 'Caldo o freddo? Scelta di gusto.' } },
};

async function apri(page, fbs, ritardo = 0) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_FEEDBACK_THREAD);
  await page.evaluate(() => window.__mgTest.whenReady && window.__mgTest.whenReady());
  await page.evaluate((ms) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        if (ms) await new Promise((r) => setTimeout(r, ms));
        return { ok: true };
      }
      return orig(msg);
    };
  }, ritardo);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((list) => window.__mgTest.setData(list), fbs);
}

async function rombo(page, id) {
  await page.locator('.mg-item').filter({ hasText: id === 'fb-a' ? 'Pulsante X' : id === 'fb-b' ? 'Menu stretto' : 'Colori' }).first().click();
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
}

test('aspetto chiaro e scuro, testo lungo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [A, B, DEC]);
  await rombo(page, 'fb-a');
  await page.locator('#mgSideRispostaText').fill('Lungo '.repeat(400));
  await page.screenshot({ path: 'tests/.shots/v1033-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/v1033-scuro.png' });
});

test('decisione: casella presente e invio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [A, B, DEC]);
  await rombo(page, 'fb-dec');
  await expect(page.locator('#mgSideRispostaText')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/v1033-decisione.png' });
  await page.locator('#mgSideRispostaText').fill('Caldo.');
  await page.locator('#mgSideRispostaBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const u = await page.evaluate(() => window.__updates[0]);
  expect(u.id).toBe('fb-dec');
  expect(u.status).toBe('todo');
  expect(u.notes).toContain('Caldo.');
});

test('doppio clic rapido: un invio solo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [A, B], 800);
  await rombo(page, 'fb-a');
  await page.locator('#mgSideRispostaText').fill('Quello in alto.');
  await page.locator('#mgSideRispostaBtn').dblclick();
  await page.locator('#mgClarifyBtn').click({ force: true }).catch(() => {});
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__updates.length)).toBe(1);
});

test('bozza per pratica: cambiando pratica non migra', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [A, B]);
  await rombo(page, 'fb-a');
  await page.locator('#mgSideRispostaText').fill('Per A');
  await page.locator('.mg-item').filter({ hasText: 'Menu stretto' }).first().click();
  await expect(page.locator('#mgClarifyText')).toHaveValue('');
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
  await expect(page.locator('#mgSideRispostaText')).toHaveValue('');
  await page.locator('#mgSideRispostaText').fill('Per B');
  await page.locator('#mgSideRispostaBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const u = await page.evaluate(() => window.__updates[0]);
  expect(u.id).toBe('fb-b');
  expect(u.notes).not.toContain('Per A');
  await page.locator('.mg-item').filter({ hasText: 'Pulsante X' }).first().click();
  await expect(page.locator('#mgClarifyText')).toHaveValue('Per A');
});

test('invio lento e cambio pratica nel frattempo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [A, B], 1500);
  await rombo(page, 'fb-a');
  await page.locator('#mgSideRispostaText').fill('Per A');
  await page.locator('#mgSideRispostaBtn').click();
  await page.locator('.mg-item').filter({ hasText: 'Menu stretto' }).first().click();
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
  await expect(page.locator('#mgSideRispostaText')).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.locator('#mgSide')).toBeVisible();
  await expect(page.locator('#mgSideRispostaText')).toBeVisible();
  await expect(page.locator('#mgSideRispostaBtn')).toBeEnabled();
  const u = await page.evaluate(() => window.__updates.map((x) => x.id));
  expect(u).toEqual(['fb-a']);
});

test('conversazione illeggibile: il pannello dice perché', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const C = { ...A, _id: 'fb-c', name: 'Cifrato', notes: 'enc:v1:AAAAAAAAAAAAAAAAAAAAAAAA' };
  await apri(page, [C]);
  await page.locator('.mg-item').filter({ hasText: 'Cifrato' }).first().click();
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l3"]').click();
  await page.screenshot({ path: 'tests/.shots/v1033-cifrato.png' });
  const n = await page.locator('#mgSideRispostaText').count();
  if (n) {
    await page.locator('#mgSideRispostaText').fill('Ciao');
    await page.locator('#mgSideRispostaBtn').click();
    await page.waitForTimeout(500);
    console.log('MSG', await page.locator('#mgSideRispostaMsg').textContent());
    expect(await page.evaluate(() => window.__updates.length)).toBe(0);
  } else console.log('NESSUNA CASELLA');
});

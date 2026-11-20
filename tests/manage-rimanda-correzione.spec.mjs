// #2575: su una bocciatura del controllo di sicurezza il tasto dei Ricevuti è «Rimanda in correzione» e la casella dice
// che il testo arriva a chi corregge. Invio va a capo, Ctrl+Invio manda; a casella vuota un avviso sul posto, e il
// secondo gesto sullo stesso tasto manda lo stesso. Sulle altre fermate niente cambia.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-2338', name: 'Bocciato dal controllo', text: 'Il tasto salva nel posto sbagliato.',
    seq: 2338, subSeq: 0, status: 'design', statusReason: 'secaudit', statusPublic: 'open', fiducia: 'fidato',
    clientId: 'owner:test', createdAt: '2026-11-10T08:00:00Z', images: [], branch: 'worker/fb-2338',
    notes: "Report: fatto.\n\n--- Aggiornamento dell'agente del 17/11/26, 10:00 ---\nIl diff manda i dati a un host nuovo.",
    livelli: { l4: { esito: 'fail', at: '2026-11-17T10:00:00.000Z' } },
  }, over);
}

async function apri(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate((id) => window.__mgTest.openDetail(id), lista[0]._id);
}

const aggiornamenti = (page) => page.evaluate(() => window.__updates);

test('il tasto si chiama «Rimanda in correzione», Invio va a capo e Ctrl+Invio manda il testo a chi corregge', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  const tasto = page.locator('#mgAcceptBtn');
  const casella = page.locator('#mgAcceptComment');
  await expect(tasto).toHaveText('Rimanda in correzione');
  await expect(tasto).toHaveAttribute('title', /chi corregge/);
  await expect(casella).toHaveAttribute('placeholder', /arriva a chi corregge/);

  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/2575-rimanda-correzione-${tema}.png` });
  }

  await casella.click();
  await page.keyboard.type('Niente host nuovi.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Tieni i dati in locale.');
  expect(await aggiornamenti(page)).toEqual([]);
  await expect(casella).toHaveValue('Niente host nuovi.\nTieni i dati in locale.');

  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => (await aggiornamenti(page)).length).toBe(1);
  expect((await aggiornamenti(page))[0]).toMatchObject({
    type: 'feedback_update', id: 'fb-2338', status: 'todo', reviewDecision: 'accepted',
    reviewComment: 'Niente host nuovi.\nTieni i dati in locale.',
  });
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (0)');
});

test('a casella vuota un avviso sul posto ferma il primo clic; il secondo sullo stesso tasto manda lo stesso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  const tasto = page.locator('#mgAcceptBtn');
  const prima = await tasto.boundingBox();
  // Sul bordo dalla parte del vicino, dove sbaglia l'utente (patterns/una-conferma-sul-posto-tiene-ferma-la-sua-scatola.md).
  const bordo = { x: prima.width - 3, y: prima.height / 2 };

  await tasto.click({ position: bordo });
  await expect(tasto).toHaveText('Manda lo stesso');
  await expect(page.locator('#mgAcceptComment')).toHaveAttribute('placeholder', /non saprà cosa correggere/);
  await expect(page.locator('#mgAcceptComment')).toHaveClass(/mg-accept-comment--avviso/);
  expect(await aggiornamenti(page)).toEqual([]);
  const armato = await tasto.boundingBox();
  expect(armato.width).toBeGreaterThanOrEqual(prima.width - 0.5);
  expect([armato.x, armato.y]).toEqual([prima.x, prima.y]);
  await page.screenshot({ path: 'tests/.shots/2575-rimanda-correzione-avviso.png' });

  await tasto.click({ position: bordo });
  await expect.poll(async () => (await aggiornamenti(page)).length).toBe(1);
  expect((await aggiornamenti(page))[0]).toMatchObject({ id: 'fb-2338', status: 'todo', reviewComment: '' });
});

test('scrivere dopo l’avviso lo toglie, e il tasto manda il testo; Ctrl+Invio a casella vuota passa dallo stesso avviso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  const tasto = page.locator('#mgAcceptBtn');
  const casella = page.locator('#mgAcceptComment');

  await casella.click();
  await page.keyboard.press('Control+Enter');
  await expect(tasto).toHaveText('Manda lo stesso');
  await expect(page.locator('#mgActionMsg')).toContainText('non saprà cosa correggere');
  expect(await aggiornamenti(page)).toEqual([]);

  await page.keyboard.type('Usa la coda che c’è già.');
  await expect(tasto).toHaveText('Rimanda in correzione');
  await expect(page.locator('#mgActionMsg')).toHaveText('');
  await tasto.click();
  await expect.poll(async () => (await aggiornamenti(page)).length).toBe(1);
  expect((await aggiornamenti(page))[0]).toMatchObject({ status: 'todo', reviewComment: 'Usa la coda che c’è già.' });
});

test('Ctrl+Invio due volte a casella vuota: avviso, poi manda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  await page.locator('#mgAcceptComment').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#mgAcceptBtn')).toHaveText('Manda lo stesso');
  await page.keyboard.press('Control+Enter');
  await expect.poll(async () => (await aggiornamenti(page)).length).toBe(1);
  expect((await aggiornamenti(page))[0]).toMatchObject({ status: 'todo', reviewComment: '' });
});

test('sulle altre fermate il tasto resta «→ In coda»: manda al primo clic e Ctrl+Invio non manda niente', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica({ _id: 'fb-904', seq: 904, statusReason: 'clarify', livelli: {} })]);
  const tasto = page.locator('#mgAcceptBtn');
  await expect(tasto).toHaveText('→ In coda');
  await expect(page.locator('#mgAcceptComment')).toHaveAttribute('placeholder', /opzionale/);
  await page.locator('#mgAcceptComment').click();
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  expect(await aggiornamenti(page)).toEqual([]);
  await tasto.click();
  await expect.poll(async () => (await aggiornamenti(page)).length).toBe(1);
  expect((await aggiornamenti(page))[0]).toMatchObject({ id: 'fb-904', status: 'todo', reviewComment: '' });
});

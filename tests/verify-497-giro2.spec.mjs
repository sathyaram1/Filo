// #497 — secondo giro avversariale: porte laterali della barra dei tasti.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';

function fb(over) {
  return {
    _id: 'x', text: 'Il bottone non fa niente', name: 'Bottone morto',
    seq: 700, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-09-01T10:00:00Z', images: [],
    status: 'todo', statusPublic: 'open', notes: '', ...over,
  };
}

async function prepara(page, lista, admin = true) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate((a) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(a);
  }, admin);
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
}
async function apri(page, id, tab) {
  await page.evaluate(({ i, t }) => { window.__mgTest.setTab(t); window.__mgTest.openDetail(i); }, { i: id, t: tab });
  await expect(page.locator('#mgDetail')).toBeVisible();
}

test('#497 K — stato cifrato: niente azioni, ma preferito e frase restano sulla riga', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'enc', status: 'FENCv1:blob', statusPublic: 'open' })]);
  await apri(page, 'enc', 'inbox');
  await expect(page.locator('#mgActions')).toBeHidden();
  await expect(page.locator('#mgStarBtn')).toBeVisible();
  await expect(page.locator('#mgUserNoteToggle')).toBeVisible();
  await expect(page.locator('#mgUserNote')).toBeHidden();
  const a = await page.locator('#mgStarBtn').boundingBox();
  const b = await page.locator('#mgUserNoteToggle').boundingBox();
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(2);
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Grazie, ci lavoriamo.');
  await page.locator('#mgUserNoteBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  await page.screenshot({ path: 'tests/.shots/497-cifrato.png' });
});

test('#497 L — Riapri e frase aperti insieme: i due moduli non si pestano', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'r1', status: 'done', statusPublic: 'closed' })]);
  await apri(page, 'r1', 'resolved');
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNote')).toBeVisible();
  await page.locator('#mgReopenBtn').click();
  await expect(page.locator('#mgReopen')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/497-riapri-e-frase.png' });
  const r = await page.locator('#mgReopen').boundingBox();
  const u = await page.locator('#mgUserNote').boundingBox();
  // nessuna sovrapposizione verticale
  const sovrappone = !(r.y + r.height <= u.y + 1 || u.y + u.height <= r.y + 1);
  expect(sovrappone, 'riapertura e frase si sovrappongono').toBe(false);
  await page.locator('#mgReopenText').fill('Manca ancora il caso della tabella.');
  await page.locator('#mgReopenConfirmBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(1);
});

test('#497 M — dopo unazione di stato la frase torna chiusa e non travasa', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'a1', status: 'todo' }), fb({ _id: 'a2', status: 'todo', seq: 701 })]);
  await apri(page, 'a1', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Fatto');
  await page.locator('#mgUserNoteBtn').click();
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Salvata');
  await apri(page, 'a2', 'queue');
  await expect(page.locator('#mgUserNote')).toBeHidden();
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNoteText')).toHaveValue('');
});

test('#497 N — Invio nella riga salva senza cercare il bottone', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'n1', status: 'todo' })]);
  await apri(page, 'n1', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Con Invio');
  await page.locator('#mgUserNoteText').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
});

test('#497 O — senza admin non compare nessuna barra', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'p1', status: 'todo' })], false);
  await apri(page, 'p1', 'queue');
  await expect(page.locator('#mgOwnerBar')).toBeHidden();
  await expect(page.locator('#mgUserNoteToggle')).toBeHidden();
});

test('#497 P — aggiornamento remoto mentre la frase è aperta con una bozza', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await prepara(page, [fb({ _id: 'q1', status: 'todo', userNote: 'vecchia' })]);
  await apri(page, 'q1', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('bozza nuova');
  console.log('PRIMA DEL CLICK', await page.locator('#mgUserNoteText').inputValue());
  await page.locator('#mgThread').click({ position: { x: 5, y: 5 } });   // cursore fuori dalla casella
  console.log('DOPO IL CLICK', await page.locator('#mgUserNoteText').inputValue(),
    'aperta:', await page.locator('#mgUserNote').isVisible());
  const ridisegnato = await page.evaluate(() => window.__mgTest.rerenderIfIdle('q1'));
  console.log('RIDISEGNATO', ridisegnato, 'valore:', await page.locator('#mgUserNoteText').inputValue());
  await expect(page.locator('#mgUserNoteText')).toHaveValue('bozza nuova');
  await expect(page.locator('#mgUserNote')).toBeVisible();
});

test('#497 Q — la gemella (pagina Feedback): dov è la frase per chi ha segnalato', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  const ha = await page.evaluate(() => !!window.__fbTest);
  console.log('HARNESS FEEDBACK', ha, await page.evaluate(() => Object.keys(window).filter((k) => /__fb|Test/.test(k))));
  await page.screenshot({ path: 'tests/.shots/497-gemella.png' });
});

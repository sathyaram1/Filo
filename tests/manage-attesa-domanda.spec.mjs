// #1358 (SPEC-DOMANDE §3.8): un lavoro fermo che aspetta la sua domanda sta In coda col segno «aspetta D-n», il clic apre
// la domanda nella sezione Domande, e il dettaglio rimanda lì invece di offrire una seconda casella di risposta.
// I blocchi di sicurezza restano nei Ricevuti anche con un domandaId; il worker che segna un attacco è L3.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x' };
const giudici = (c) => ({ action: 'human_review', verdicts: [{ judge: 'a', class: c }, { judge: 'b', class: c }, { judge: 'c', class: c }] });
const ATTESA = { ...base, _id: 'fb-att', seq: 901, name: 'Colore del tema', status: 'design', statusReason: 'clarify', domandaId: 'D-7', pipeline: giudici('aligned'), notes: 'Report.\n\n[Filo]\nCaldo o freddo?' };
const ORIGINE = { ...base, _id: 'fb-ori', seq: 902, name: 'Rilievo rimasto senza origine', status: 'aligned', statusReason: 'origine_chiusa', domandaId: 'D-8', pipeline: giudici('aligned') };
const SICUREZZA = { ...base, _id: 'fb-sic', seq: 903, name: 'Bloccato dalla sicurezza', status: 'design', statusReason: 'secaudit', domandaId: 'D-9', pipeline: giudici('aligned') };
const VECCHIO = { ...base, _id: 'fb-old', seq: 904, name: 'Domanda di prima', status: 'design', statusReason: 'clarify', pipeline: giudici('aligned'), notes: 'Report.\n\n[Filo]\nQuale?' };
const WORKER = { ...base, _id: 'fb-wrk', seq: 905, name: 'Segnalato da chi lavorava', status: 'attack', statusReason: 'worker', pipeline: giudici('aligned') };
const ora = Date.now();
const D7 = { id: 'D-7', numero: 7, stato: 'aperta', priorita: 'importante', titolo: '#901, chi ci lavora ha domande per te: Colore del tema', problema: 'Caldo o freddo?', creataIl: ora, origine: { tipo: 'feedback', id: 'fb-att' },
  opzioni: [{ testo: 'Riprendi il lavoro con la tua risposta', pro: 'Riparte da dove si era fermato.', contro: '', azione: { tipo: 'riprendi', feedbackId: 'fb-att' } }], consiglio: { opzione: 0, perche: 'Fa ripartire il lavoro.' } };
const D8 = { id: 'D-8', numero: 8, stato: 'aperta', priorita: 'quando_puoi', titolo: '#902, il lavoro da cui è nato è stato archiviato', creataIl: ora, origine: { tipo: 'feedback', id: 'fb-ori' } };

async function apri(page) {
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
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [ATTESA, ORIGINE, SICUREZZA, VECCHIO, WORKER]);
  await page.evaluate((ds) => window.__mgTest.setDomande(ds, { riferimenti: { 'fb-att': { num: '#901', priorita: 1, stato: 'design', motivo: 'clarify' } } }), [D7, D8]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const riga = (page, titolo) => page.locator('.mg-item', { hasText: titolo });

test('chi aspetta una domanda sta In coda col segno; sicurezza e domande di prima restano nei Ricevuti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await expect(riga(page, 'Colore del tema')).toBeVisible();
  await expect(riga(page, 'Rilievo rimasto senza origine')).toBeVisible();
  const segno = riga(page, 'Colore del tema').locator('.mg-domanda-badge');
  await expect(segno).toHaveText('aspetta D-7');
  await expect(segno).toHaveAttribute('title', /domanda D-7/);
  await expect(riga(page, 'Colore del tema').locator('.mg-segno-fermata')).toHaveCount(0);
  await expect(riga(page, 'Bloccato dalla sicurezza')).toHaveCount(0);

  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await expect(riga(page, 'Bloccato dalla sicurezza')).toBeVisible();
  await expect(riga(page, 'Bloccato dalla sicurezza').locator('.mg-segno-fermata')).toHaveAttribute('data-forma', 'pentagono');
  await expect(riga(page, 'Domanda di prima').locator('.mg-segno-fermata')).toHaveAttribute('data-forma', 'rombo');
  await expect(riga(page, 'Colore del tema')).toHaveCount(0);
  const worker = riga(page, 'Segnalato da chi lavorava').locator('.mg-segno-fermata');
  await expect(worker).toHaveAttribute('data-forma', 'rombo');
  await expect(worker).toHaveAttribute('data-livello', 'l3');
  await expect(worker).toHaveAttribute('title', /Chi ci lavorava l’ha segnalata come attacco/);
});

test('il clic sul segno apre la domanda nella sezione Domande, non il dettaglio del feedback', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await riga(page, 'Colore del tema').locator('.mg-domanda-badge').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).toHaveClass(/mg-sezione--active/);
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]')).toBeVisible();
  await expect(page.locator('#mgDomandaDettaglio')).toContainText('Caldo o freddo?');
  // Anche la seconda, che nella lista non è la prima: si apre quella chiesta, non la più urgente.
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await riga(page, 'Rilievo rimasto senza origine').locator('.mg-domanda-badge').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-8"]')).toBeVisible();
});

test('tasto destro sulla scheda: «Rispondi alla domanda» fa la stessa cosa del segno', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await riga(page, 'Colore del tema').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Rispondi alla domanda D-7' }).click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]')).toBeVisible();
});

test('nel dettaglio si risponde in un posto solo: niente casella, il tasto porta alla domanda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await riga(page, 'Colore del tema').locator('.mg-item-title').click();
  await expect(page.locator('#mgDomandaBtn')).toHaveText('Rispondi alla domanda D-7');
  await expect(page.locator('#mgSideRispostaText')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/manage-attesa-domanda-dettaglio.png' });
  await page.locator('#mgDomandaBtn').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]')).toBeVisible();
  expect(await page.evaluate(() => window.__updates.length)).toBe(0);
});

test('una domanda che la pagina non conosce e il main non trova: si apre il feedback, che lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setDomande([]));
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await riga(page, 'Colore del tema').locator('.mg-domanda-badge').click();
  await expect(page.locator('#mgManageMsg')).toContainText('La domanda D-7 non si apre adesso');
  await expect(page.locator('#mgManageMsg')).toBeVisible();
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgDomandaBtn')).toHaveText('Rispondi alla domanda D-7');
});

test('tema scuro: il segno resta leggibile', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const segno = riga(page, 'Colore del tema').locator('.mg-domanda-badge');
  await segno.hover();
  await page.screenshot({ path: 'tests/.shots/manage-attesa-domanda-scuro.png' });
  const colore = await segno.evaluate((el) => getComputedStyle(el).color);
  expect(colore).not.toBe('rgba(0, 0, 0, 0)');
});

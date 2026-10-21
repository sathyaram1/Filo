// #1358 (SPEC-DOMANDE §3.8): un feedback fermo con la sua domanda sta In coda col segno «aspetta una domanda», e un
// clic sul segno apre la domanda fra le Domande; nel dettaglio il rimando prende il posto della casella di risposta.
// Un blocco di sicurezza con un domandaId resta nei Ricevuti; attacco e spam di chi lavora sono L3. Il main è finto.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';
const giudici = (cls) => ({
  action: 'human_review', l1Category: 'clean',
  expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
  verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: cls, reasoning: 'x' })),
});
const base = { clientId: 'tester@example.com', createdAt: '2026-10-20T08:00:00Z', images: [], subSeq: 0, text: 'x', pipeline: giudici('aligned') };
const FERMO = { ...base, _id: 'fb-dom', seq: 1401, name: 'Colore del tasto', status: 'design', statusReason: 'clarify', domandaId: 'D-7', notes: 'Report.\n\n[Filo]\nDomande per l\'owner (chi risolve):\nQuale colore?' };
const SICUREZZA = { ...base, _id: 'fb-sic', seq: 1402, name: 'Bocciato dalla sicurezza', status: 'design', statusReason: 'secaudit', domandaId: 'D-8' };
const ATTACCO = { ...base, _id: 'fb-att', seq: 1403, name: 'Vuole la chiave', status: 'attack', statusReason: 'worker', pipeline: giudici('aligned') };
const SENZA = { ...base, _id: 'fb-sen', seq: 1404, name: 'Fermo di prima', status: 'design', statusReason: 'clarify', notes: 'Report.\n\n[Filo]\nQuale forma?' };
const ora = Date.now();
const D7 = { id: 'D-7', numero: 7, stato: 'aperta', priorita: 'importante', titolo: '#1401 aspetta una tua risposta: Colore del tasto', problema: 'Quale colore?', creataIl: ora,
  opzioni: [{ testo: 'Riprendi con la mia risposta', pro: 'riparte', contro: '', azione: { tipo: 'riprendi', feedbackId: 'fb-dom' } }], consiglio: { opzione: 0, perche: 'aspetta' },
  collegamenti: [{ tipo: 'feedback', id: 'fb-dom' }], origine: { tipo: 'feedback', id: 'fb-dom' } };

async function apri(page, feedbacks, domande = [D7]) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), feedbacks);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((d) => window.__mgTest.setDomande(d), domande);
}

const riga = (page, titolo) => page.locator('#mgList .mg-item', { hasText: titolo });

test('fermo con la sua domanda: In coda col segno, non nei Ricevuti; il segno apre la domanda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FERMO, SICUREZZA, ATTACCO, SENZA]);

  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await expect(riga(page, 'Bocciato dalla sicurezza')).toHaveCount(1);
  await expect(riga(page, 'Fermo di prima')).toHaveCount(1);
  await expect(riga(page, 'Colore del tasto')).toHaveCount(0);
  await expect(riga(page, 'Bocciato dalla sicurezza').locator('.mg-domanda-badge')).toHaveCount(0);

  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const badge = riga(page, 'Colore del tasto').locator('.mg-domanda-badge');
  await expect(badge).toHaveText('D-7');
  await expect(badge).toHaveAttribute('title', /Aspetta una tua risposta nella domanda D-7/);
  await expect(riga(page, 'Colore del tasto').locator('.mg-segno-fermata')).toHaveCount(0);
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await riga(page, 'Colore del tasto').screenshot({ path: `tests/.shots/attesa-domanda-riga-${tema}.png` });
  }

  await badge.click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('.mg-tab[data-tab="domande"]')).toHaveClass(/mg-tab--active/);
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]')).toBeVisible();
  await expect(page.locator('#mgDomandaDettaglio')).toContainText('Colore del tasto');
});

test('il clic sulla riga apre il feedback; nel dettaglio si risponde nella domanda, non in una casella', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FERMO, SENZA]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await riga(page, 'Colore del tasto').locator('.mg-item-title').click();
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  const rimando = page.locator('#mgSideDomandaBtn');
  await expect(rimando).toHaveText('Rispondi nella domanda D-7');
  await expect(page.locator('#mgSideRispostaText')).toHaveCount(0);
  // In coda ma fermo: «Risolto» non c'è (design → done non è dell'owner), rimetterlo in coda sì.
  await expect(page.locator('#mgActions button', { hasText: 'Risolto' })).toHaveCount(0);
  await expect(page.locator('#mgActions button', { hasText: '→ In coda' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/attesa-domanda-dettaglio.png' });
  await rimando.click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-7"]')).toBeVisible();

  // Una fermata di prima, senza domanda, tiene la sua casella nei Ricevuti.
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await riga(page, 'Fermo di prima').locator('.mg-item-title').click();
  await expect(page.locator('#mgSideRispostaText')).toBeVisible();
  await expect(page.locator('#mgSideDomandaBtn')).toHaveCount(0);
});

test('una domanda che la pagina non ha ancora: il segno lo dice, senza cambiare pagina', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [FERMO], []);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await riga(page, 'Colore del tasto').locator('.mg-domanda-badge').click();
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgToast')).toContainText('La domanda D-7 non si trova');
});

test('attacco segnato da chi lavorava: rombo L3 nei Ricevuti, contato fra gli L3', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [ATTACCO, SICUREZZA]);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  const segno = riga(page, 'Vuole la chiave').locator('.mg-segno-fermata');
  await expect(segno).toHaveAttribute('data-forma', 'rombo');
  await expect(segno).toHaveAttribute('data-livello', 'l3');
  await expect(segno).toHaveAttribute('title', /Chi ci lavorava l’ha segnalata come attacco/);
  await expect(page.locator('#mgLivelliFiltro .mg-livello-btn[data-livello="l3"]')).toHaveText('L3 (1)');
});

test('pagina dei feedback: stessa scheda, il segno della domanda e niente casella', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__fbTest.setAdmin(true));
  await page.evaluate((fbs) => window.__fbTest.setData(fbs), [FERMO, SENZA]);
  await page.evaluate(() => window.__fbTest.setTab('queue'));
  const scheda = page.locator('.fb-card', { hasText: 'Colore del tasto' });
  await expect(scheda.locator('.fb-domanda')).toHaveText('◇ D-7');
  await expect(scheda.locator('.fb-reply-text')).toHaveCount(0);
  await expect(scheda.locator('.fb-reply--domanda')).toContainText('domanda D-7');
  await page.evaluate(() => window.__fbTest.setTab('inbox'));
  await expect(page.locator('.fb-card', { hasText: 'Colore del tasto' })).toHaveCount(0);
  await expect(page.locator('.fb-card', { hasText: 'Fermo di prima' }).locator('.fb-reply-text')).toHaveCount(1);
});

// #1577 (SPEC-DOMANDE §3.1 `blocca`): un lavoro in coda fermo su una domanda bloccante sta fra quelli che aspettano col
// segno «aspetta D-n», che apre la domanda; la domanda dice se ferma il suo lavoro; il guasto con la sua domanda sta In
// coda, non nei Ricevuti. Le risposte che non spostano il lavoro dicono cosa è successo.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x' };
const giudici = (c) => ({ action: 'human_review', verdicts: [{ judge: 'a', class: c }, { judge: 'b', class: c }, { judge: 'c', class: c }] });
const FERMO = { ...base, _id: 'fb-fermo', seq: 1001, name: 'Bordo delle schede', status: 'todo', domandeBloccanti: ['D-21'], pipeline: giudici('aligned') };
const VERIFICA = { ...base, _id: 'fb-verifica', seq: 1002, name: 'Ordine delle schede', status: 'revision_capability', branch: 'worker/x', domandeBloccanti: ['D-22', 'D-24'], pipeline: giudici('aligned') };
const LIBERO = { ...base, _id: 'fb-libero', seq: 1003, name: 'Colore del cursore', status: 'todo', domandeBloccanti: [], pipeline: giudici('aligned') };
const GUASTO = { ...base, _id: 'fb-guasto', seq: 1004, name: 'Installazione rotta', status: 'design', statusReason: 'guasto', domandaId: 'D-23', pipeline: giudici('aligned') };
const GUASTO_DI_PRIMA = { ...base, _id: 'fb-guasto-old', seq: 1005, name: 'Guasto di prima', status: 'design', statusReason: 'guasto', pipeline: giudici('aligned') };
const ora = Date.now();
const opzioni = (fid) => [
  { testo: 'Caldo', pro: 'è Filo', contro: 'meno contrasto', azione: { tipo: 'riprendi', feedbackId: fid } },
  { testo: 'Freddo', pro: 'più contrasto', contro: 'non è Filo', azione: { tipo: 'riprendi', feedbackId: fid } },
];
const domanda = (id, fid, extra = {}) => Object.assign({ id, numero: Number(id.slice(2)), stato: 'aperta', priorita: 'importante', titolo: `Domanda ${id}`,
  problema: 'Il colore del bordo va scelto.', creataIl: ora, origine: { tipo: 'feedback', id: fid }, opzioni: opzioni(fid),
  consiglio: { opzione: 0, perche: 'Filo ha colori caldi' }, legata: fid, blocca: true }, extra);
const D21 = domanda('D-21', 'fb-fermo');
const D22 = domanda('D-22', 'fb-verifica');
const D24 = domanda('D-24', 'fb-verifica', { blocca: false, provvisoria: 0, titolo: 'Domanda che non ferma' });
const D23 = domanda('D-23', 'fb-guasto', { titolo: 'Guasto: npm non installa', attesa: { feedbackId: 'fb-guasto', motivo: 'guasto' } });
const RIF = {
  'fb-fermo': { num: '#1001', priorita: 1, stato: 'todo', motivo: '' },
  'fb-verifica': { num: '#1002', priorita: 1, stato: 'revision_capability', motivo: '' },
  'fb-guasto': { num: '#1004', priorita: 1, stato: 'design', motivo: 'guasto' },
};

async function apri(page, { rispondi } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((esito) => {
    window.__risposte = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'domanda_rispondi' && esito) {
        window.__risposte.push(msg);
        const d = window.__mgTest.domandeStato().domande.find((x) => x.id === msg.id);
        const e = Object.assign({ ok: true, applicataIl: Date.now() }, esito);
        return { ok: true, domanda: Object.assign({}, d, { stato: 'chiusa', esito: e }), esito: e };
      }
      return orig(msg);
    };
  }, rispondi || null);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), [FERMO, VERIFICA, LIBERO, GUASTO, GUASTO_DI_PRIMA]);
  await page.evaluate(([ds, riferimenti]) => window.__mgTest.setDomande(ds, { riferimenti }), [[D21, D22, D23, D24], RIF]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const riga = (page, titolo) => page.locator('.mg-item', { hasText: titolo });

test('il lavoro fermo su una domanda bloccante sta fra quelli che aspettano, col segno; senza domanda resta In coda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setTab('waiting'));
  const segno = riga(page, 'Bordo delle schede').locator('.mg-domanda-badge');
  await expect(segno).toHaveText('aspetta D-21');
  await expect(segno).toHaveAttribute('title', 'Nessuna routine lo prende finché non rispondi alla domanda D-21: apri D-21');
  const due = riga(page, 'Ordine delle schede').locator('.mg-domanda-badge');
  await expect(due).toHaveText('aspetta D-22');
  await expect(due).toHaveAttribute('title', /alle domande D-22, D-24/);
  // La riga del lavoro dice il vero: non aspetta un verificatore, aspetta te.
  await expect(riga(page, 'Ordine delle schede').locator('.mg-work-idle')).toHaveText('Nessuna istanza al lavoro: riparte quando rispondi a D-22, D-24');
  await expect(riga(page, 'Colore del cursore')).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/manage-domanda-bloccante-aspettano.png' });

  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await expect(riga(page, 'Colore del cursore')).toBeVisible();
  await expect(riga(page, 'Colore del cursore').locator('.mg-domanda-badge')).toHaveCount(0);
  await expect(riga(page, 'Bordo delle schede')).toHaveCount(0);
});

test('il segno apre la domanda, che dice se ferma il suo lavoro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setTab('waiting'));
  await riga(page, 'Bordo delle schede').locator('.mg-domanda-badge').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-21"]');
  await expect(dq).toBeVisible();
  const ferma = dq.locator('.mg-dq-ferma');
  await expect(ferma).toHaveText('ferma #1001');
  await expect(ferma).toHaveClass(/mg-dq-ferma--si/);
  await expect(ferma).toHaveAttribute('title', 'Nessuna routine lo prende finché non rispondi.');
  await page.screenshot({ path: 'tests/.shots/manage-domanda-bloccante-domanda.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await ferma.hover();
  await page.screenshot({ path: 'tests/.shots/manage-domanda-bloccante-domanda-scuro.png' });
  expect(await ferma.evaluate((el) => getComputedStyle(el).color)).not.toBe(await dq.locator('.mg-dq-data').first().evaluate((el) => getComputedStyle(el).color));
  await page.emulateMedia({ colorScheme: 'light' });

  // Quella che non ferma lo dice: il lavoro va avanti con la consigliata.
  await page.evaluate(() => window.SN_MG_DOMANDE.apriDomanda('D-24'));
  const avanti = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-24"] .mg-dq-ferma');
  await expect(avanti).toHaveText('#1002 va avanti');
  await expect(avanti).not.toHaveClass(/mg-dq-ferma--si/);
  await expect(avanti).toHaveAttribute('title', /anche se è già fuso/);
});

test('tasto destro e dettaglio fanno la stessa cosa del segno', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setTab('waiting'));
  await riga(page, 'Bordo delle schede').click({ button: 'right' });
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Rispondi alla domanda D-21' }).click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-21"]')).toBeVisible();
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await page.evaluate(() => window.__mgTest.setTab('waiting'));
  await riga(page, 'Bordo delle schede').locator('.mg-item-title').click();
  await expect(page.locator('#mgDomandaBtn')).toHaveText('Rispondi alla domanda D-21');
});

test('il guasto con la sua domanda sta In coda col segno; uno di prima, senza, resta nei Ricevuti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await expect(riga(page, 'Installazione rotta').locator('.mg-domanda-badge')).toHaveText('aspetta D-23');
  await expect(riga(page, 'Installazione rotta').locator('.mg-domanda-badge')).toHaveAttribute('title', /domanda D-23 \(fermo per un guasto\)/);
  await expect(riga(page, 'Guasto di prima')).toHaveCount(0);
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await expect(riga(page, 'Guasto di prima')).toBeVisible();
  await expect(riga(page, 'Installazione rotta')).toHaveCount(0);
  // La domanda del guasto è un'attesa: lo stop lo dice già il feedback, la riga «ferma» non si ripete.
  await page.evaluate(() => window.SN_MG_DOMANDE.apriDomanda('D-23'));
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-23"]')).toBeVisible();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-23"] .mg-dq-ferma')).toHaveCount(0);
});

for (const [esito, testo] of [[{ accodata: true }, /la prende il prossimo giro di lavoro/], [{ nonServiva: true }, /Non serviva: il lavoro è già fuso con questa scelta/]]) {
  test(`una ripresa che non sposta il lavoro lo dice: ${Object.keys(esito)[0]}`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await apri(page, { rispondi: esito });
    await page.evaluate(() => window.SN_MG_DOMANDE.apriDomanda('D-22'));
    const dq = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-22"]');
    await dq.locator('button.mg-dq-azione[data-scelta="1"]').click();
    await expect.poll(() => page.evaluate(() => window.__risposte.length)).toBe(1);
    await expect(page.locator('#mgDomandaDettaglio .mg-dq-esito')).toHaveText(testo);
  });
}

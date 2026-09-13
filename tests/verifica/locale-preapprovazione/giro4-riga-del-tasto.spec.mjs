// VERIFICA LOCALE, giro 4 — Gestione: il tasto «Fondi senza chiedermelo»
// dopo il pass del giro 3.
//
// Scritta da fuori, senza guardare il lavoro. Le prove dei giri 1, 2 e 3 si
// rilanciano intere prima di queste (stessa cartella). Qui si prova quello
// che un pass non copre da solo: la RIGA in cui vive il tasto nel dettaglio,
// e che il resto sia rimasto coerente attorno a lei.
//   1. sulla segnalazione con più tasti di stato (file sospetto nei Ricevuti:
//      quattro azioni, più preferito e frase) i tasti di stato restano su una
//      riga sola, e il tasto del segno sta SOTTO, intero, non troncato;
//   2. col segno messo, il nome del tasto cambia e la riga che dice chi e
//      quando sta accanto al tasto, non sopra o sotto;
//   3. mettere e togliere dal dettaglio: il tasto resta dov'era, il messaggio
//      d'esito non lo sposta né lo copre;
//   4. pratica chiusa: né tasto né riga; passando da una pratica aperta a una
//      chiusa e poi di nuovo a una aperta la riga segue lo stato giusto;
//   5. chi non è l'owner non vede il tasto nemmeno adesso che sta fuori dal
//      gruppo dei tasti;
//   6. tema chiaro e scuro: catture da guardare, col segno e senza.
//
// Il canale verso il main è sostituito (stesso schema dei giri 1–3): il codice
// VERO di lettura e disegno gira.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-pre-004',
    text: 'Il segno «Fondi senza chiedermelo» va su una riga sua.',
    name: 'Riga del tasto',
    seq: 504,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-12T10:00:00Z',
    images: [],
    status: 'working',
    statusPublic: 'open',
  }, over);
}

const SEGNO = { by: 'owner@esempio', at: '2026-09-13T08:00:00.000Z' };

async function apri(page, { admin = true, fbs = [] } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__preCalls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      if (t === 'feedback_update') {
        window.__preCalls.push(msg);
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        return msg.mergePreapproved === true ? { ok: true, by: 'owner@esempio' } : { ok: true };
      }
      return orig(msg);
    };
  }, { admin });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), fbs);
}

async function apriDettaglio(page, fb) {
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
}

// Le misure che contano: quante righe occupano i tasti di stato+preferito+frase,
// dove sta il tasto del segno rispetto a loro, e se il suo nome è intero.
async function misure(page) {
  return page.evaluate(() => {
    const riga = [...document.querySelectorAll('#mgOwnerBar .mg-owner-row button')].filter((b) => b.offsetParent !== null);
    const tops = [...new Set(riga.map((b) => Math.round(b.getBoundingClientRect().top / 8)))];
    const fondoRiga = Math.max(...riga.map((b) => b.getBoundingClientRect().bottom));
    const btn = document.getElementById('mgPreapproveBtn');
    const info = document.getElementById('mgPreapprovedInfo');
    const line = document.getElementById('mgPreapproveLine');
    const rb = btn.getBoundingClientRect();
    const ib = info.getBoundingClientRect();
    const det = document.getElementById('mgDetail');
    return {
      tastiRiga: riga.length,
      righe: tops.length,
      fondoRiga,
      btnVisibile: btn.offsetParent !== null,
      btnTop: rb.top,
      btnBottom: rb.bottom,
      btnRight: rb.right,
      btnTesto: btn.textContent.trim(),
      btnTroncato: btn.scrollWidth > btn.clientWidth + 1,
      btnTitle: btn.title,
      infoVisibile: info.offsetParent !== null,
      infoTop: ib.top,
      infoBottom: ib.bottom,
      infoLeft: ib.left,
      infoTesto: info.textContent.trim(),
      lineVisibile: line.offsetParent !== null,
      dettaglioSborda: det.scrollWidth > det.clientWidth + 1,
    };
  });
}

// ── 1. Quattro azioni: i tasti di stato su una riga, il segno sotto, intero ─

test('file sospetto nei Ricevuti: sei tasti su una riga sola e «Fondi senza chiedermelo» sotto, intero', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-sosp', seq: 505, status: 'suspicious_file', statusPublic: 'open' });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(page.locator('#mgPreapproveBtn')).toBeVisible();
  const m = await misure(page);
  expect(m.tastiRiga).toBe(6);
  expect(m.righe).toBe(1);
  expect(m.btnVisibile).toBe(true);
  expect(m.btnTop).toBeGreaterThanOrEqual(m.fondoRiga);
  expect(m.btnTesto).toBe('Fondi senza chiedermelo');
  expect(m.btnTroncato).toBe(false);
  expect(m.btnTitle.length).toBeGreaterThan(20);
  expect(m.infoVisibile).toBe(false);
  expect(m.dettaglioSborda).toBe(false);
});

// ── 2. Col segno: nome cambiato e la riga di chi/quando accanto al tasto ────

test('col segno: «Chiedimi prima di fondere» e chi/quando sulla stessa riga, a destra del tasto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-sosp2', seq: 506, status: 'suspicious_file', statusPublic: 'open', mergePreapproved: SEGNO });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await expect(page.locator('#mgPreapproveBtn')).toHaveAttribute('aria-pressed', 'true');
  const m = await misure(page);
  expect(m.righe).toBe(1);
  expect(m.btnTop).toBeGreaterThanOrEqual(m.fondoRiga);
  expect(m.btnTroncato).toBe(false);
  expect(m.infoVisibile).toBe(true);
  expect(m.infoTesto).toMatch(/segno messo da owner@esempio il \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  // Accanto: stessa fascia verticale, e comincia dopo il bordo destro del tasto.
  expect(m.infoTop).toBeLessThan(m.btnBottom);
  expect(m.infoBottom).toBeGreaterThan(m.btnTop);
  expect(m.infoLeft).toBeGreaterThanOrEqual(m.btnRight);
  expect(m.dettaglioSborda).toBe(false);
  // In lista il segno c'è, con chi l'ha messo in hover.
  const inLista = page.locator('#mgList .mg-preapproved');
  await expect(inLista).toHaveCount(1);
  await expect(inLista).toHaveAttribute('title', /owner@esempio/);
});

// ── 3. Mettere e togliere: il tasto resta dov'è, il messaggio non lo sposta ─

test('mettere e togliere dal dettaglio: il tasto non si sposta e il messaggio d esito non lo copre', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-sosp3', seq: 507, status: 'suspicious_file', statusPublic: 'open' });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  const prima = await misure(page);
  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgManageMsg')).toHaveText('Da ora si fonde senza chiedere.');
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  const dopo = await misure(page);
  expect(dopo.righe).toBe(1);
  expect(dopo.btnTop).toBeGreaterThanOrEqual(dopo.fondoRiga);
  expect(dopo.infoVisibile).toBe(true);
  expect(dopo.infoLeft).toBeGreaterThanOrEqual(dopo.btnRight);
  expect(dopo.dettaglioSborda).toBe(false);
  // Il messaggio non si sovrappone al tasto.
  const sovrapposti = await page.evaluate(() => {
    const a = document.getElementById('mgManageMsg').getBoundingClientRect();
    const b = document.getElementById('mgPreapproveBtn').getBoundingClientRect();
    return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
  });
  expect(sovrapposti).toBe(false);
  await expect(page.locator('#mgList .mg-preapproved')).toHaveCount(1);
  // Togli: torna com'era, e in lista sparisce.
  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgManageMsg')).toHaveText('Da ora ti chiede prima di fondere.');
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');
  const fine = await misure(page);
  expect(fine.infoVisibile).toBe(false);
  expect(Math.abs(fine.btnTop - prima.btnTop)).toBeLessThan(2);
  await expect(page.locator('#mgList .mg-preapproved')).toHaveCount(0);
  const calls = await page.evaluate(() => window.__preCalls);
  expect(calls.map((c) => c.mergePreapproved)).toEqual([true, false]);
});

// ── 4. Aperta → chiusa → aperta: la riga segue lo stato giusto ──────────────

test('da una pratica aperta col segno a una chiusa e ritorno: la riga c è solo sulle aperte, col testo giusto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const aperta = pratica({ _id: 'fb-ap', seq: 508, mergePreapproved: SEGNO });
  const chiusa = pratica({ _id: 'fb-ch', seq: 509, status: 'done', statusPublic: 'closed', mergePreapproved: SEGNO });
  const senza = pratica({ _id: 'fb-se', seq: 510 });
  await apri(page, { fbs: [aperta, chiusa, senza] });
  await apriDettaglio(page, aperta);
  await expect(page.locator('#mgPreapproveLine')).toBeVisible();
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await apriDettaglio(page, chiusa);
  await expect(page.locator('#mgPreapproveLine')).toBeHidden();
  await expect(page.locator('#mgPreapproveBtn')).toBeHidden();
  await apriDettaglio(page, senza);
  await expect(page.locator('#mgPreapproveLine')).toBeVisible();
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
  await apriDettaglio(page, aperta);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await expect(page.locator('#mgPreapprovedInfo')).toBeVisible();
});

// ── 5. Non owner: il tasto non c'è, nemmeno fuori dal gruppo dei tasti ──────

test('chi non è l owner non vede il tasto né la riga, anche su una pratica aperta col segno', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: SEGNO });
  await apri(page, { admin: false, fbs: [fb] });
  await apriDettaglio(page, fb);
  await expect(page.locator('#mgPreapproveBtn')).toBeHidden();
  await expect(page.locator('#mgPreapproveLine')).toBeHidden();
  await expect(page.locator('#mgPreapprovedInfo')).toBeHidden();
});

// ── 6. Tema chiaro e scuro: catture ─────────────────────────────────────────

test('tema scuro e chiaro: catture del dettaglio con la riga del tasto, col segno e senza', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const con = pratica({ _id: 'fb-con', seq: 511, status: 'suspicious_file', statusPublic: 'open', mergePreapproved: SEGNO });
  const senza = pratica({ _id: 'fb-senza', seq: 512, status: 'suspicious_file', statusPublic: 'open' });
  await apri(page, { fbs: [con, senza] });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await apriDettaglio(page, con);
    await expect(page.locator('#mgPreapprovedInfo')).toBeVisible();
    await page.screenshot({ path: `tests/.shots/preapprovazione-giro4-riga-con-${scheme}.png` });
    await apriDettaglio(page, senza);
    await expect(page.locator('#mgPreapproveBtn')).toHaveText('Fondi senza chiedermelo');
    await page.screenshot({ path: `tests/.shots/preapprovazione-giro4-riga-senza-${scheme}.png` });
  }
});

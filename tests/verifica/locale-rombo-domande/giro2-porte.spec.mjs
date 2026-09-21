// VERIFICA LOCALE, giro 2 — le porte del rombo verde quando una segnalazione
// aspetta una risposta dell'owner.
//
// Parto dal solo sintomo: in Gestione, dove compare la casella «Rispondi alle
// domande di Filo», il rombo della fila deve essere verde e dentro ci devono
// essere le domande a cui rispondere. Il giro 1 ha già chiuso il cammino
// principale; qui provo le strade laterali e quelle segnate dai giri passati:
// pratiche scritte alla vecchia maniera con un motivo di stato divergente,
// segnalazione registrata INSIEME alle domande, conversazioni a più turni,
// sotto-pratiche, e i casi limite di testo.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-g2-001',
    text: 'Quando trascino una scheda su un’altra finestra sparisce.',
    name: 'Scheda persa nel trascinamento',
    seq: 902,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-19T10:00:00Z',
    images: [],
    status: 'design',
    statusReason: 'clarify',
    statusPublic: 'open',
    notes: 'La scheda spariva su una finestra staccata o su una già aperta?',
  }, over);
}

async function apri(page, { admin = true, fbs = [] } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__inviati = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      if (t === 'feedback_update') { window.__inviati.push(msg); return { ok: true }; }
      return orig(msg);
    };
  }, { admin });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((list) => window.__mgTest.setData(list), fbs);
}

async function apriDettaglio(page, fb) {
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
}

/** Com'è il rombo adesso. */
async function rombo(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#mgForme [data-livello="l3"]');
    if (!el) return null;
    return {
      esito: el.dataset.esito,
      verde: el.classList.contains('mg-forma--design'),
      grigio: el.classList.contains('mg-forma--vuota'),
    };
  });
}

const casella = (page) => page.locator('#mgClarify').isVisible();

/** Clicca il rombo e restituisce il testo del pannello che si apre. */
async function pannelloDelRombo(page) {
  await page.locator('#mgForme [data-livello="l3"]').click();
  await expect(page.locator('#mgSide')).toBeVisible();
  return page.evaluate(() => document.querySelector('#mgSideBody').innerText);
}

// ── 1. Conversazione a più turni: l'ultima domanda è quella da leggere ──────

test('dopo una risposta arrivano nuove domande: la casella torna e il rombo è di nuovo verde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({
    notes: [
      'Quale finestra?',
      '--- La tua risposta del 19/09/2026, 10:00 ---',
      'Una staccata.',
      '--- Filo ha risposto il 19/09/2026, 11:00 ---',
      'Anche con una sola scheda dentro la finestra staccata?',
    ].join('\n'),
  });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);

  expect(await casella(page)).toBe(true);
  expect((await rombo(page)).verde).toBe(true);
  const testo = await pannelloDelRombo(page);
  expect(testo).toContain('Anche con una sola scheda');
});

// ── 2. La porta del giro passato: forma vecchia con motivo divergente ───────

for (const motivo of ['loop', 'judges', 'secaudit', null]) {
  test(`pratica vecchia in clarify con motivo «${motivo}»: casella e rombo vanno insieme`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    const fb = pratica({ _id: `fb-g2-vecchia-${motivo}`, status: 'clarify', statusReason: motivo });
    await apri(page, { fbs: [fb] });
    await apriDettaglio(page, fb);

    const c = await casella(page);
    const r = await rombo(page);
    expect(c).toBe(true);
    expect(r.verde).toBe(true);
    expect(r.grigio).toBe(false);
  });
}

// ── 3. La porta del giro passato: segnalazione registrata E domande aperte ──

test('segnalazione già registrata e domande in attesa: il pannello nomina le domande', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({
    _id: 'fb-g2-doppia',
    livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-19T09:00:00Z', testo: 'Due strade per il trascinamento: scelga l’owner.' } },
    notes: 'Preferisci che la scheda torni indietro o che apra una finestra nuova?',
  });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);

  expect(await casella(page)).toBe(true);
  expect((await rombo(page)).verde).toBe(true);
  const testo = await pannelloDelRombo(page);
  expect(testo).toContain('Preferisci che la scheda torni indietro');
  expect(testo).toContain('Due strade per il trascinamento');
  // La cosa a cui rispondere ADESSO viene prima della segnalazione vecchia.
  expect(testo.indexOf('Preferisci che la scheda')).toBeLessThan(testo.indexOf('Due strade per il trascinamento'));
});

// ── 4. Casi limite del testo: l'invariante non si rompe ─────────────────────

const LIMITI = [
  ['domanda lunghissima', 'D'.repeat(10000)],
  ['testo ostile', '<script>window.__bucato = 1;</script><img src=x onerror="window.__bucato=1">'],
  ['emoji e accenti', '🧵 Vuoi che il filo resti attaccato? Sì/No — «àèìòù»'],
  ['soli spazi', '     \n   \t  '],
  ['vuoto', ''],
];

for (const [nome, note] of LIMITI) {
  test(`domande «${nome}»: la casella e il rombo dicono la stessa cosa`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    const fb = pratica({ _id: `fb-g2-lim-${nome.replace(/\s/g, '-')}`, notes: note });
    await apri(page, { fbs: [fb] });
    await apriDettaglio(page, fb);

    expect(await casella(page)).toBe(true);
    expect((await rombo(page)).verde).toBe(true);
    await pannelloDelRombo(page);
    // Il pannello non resta muto: o la domanda, o la frase che dice di cercarla.
    const testo = await page.evaluate(() => document.querySelector('#mgSideBody').innerText.trim());
    expect(testo.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__bucato || null)).toBe(null);
  });
}

test('note assenti del tutto: il rombo resta verde e il pannello spiega dove guardare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-g2-senza-note' });
  delete fb.notes;
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);

  expect(await casella(page)).toBe(true);
  expect((await rombo(page)).verde).toBe(true);
  const testo = await pannelloDelRombo(page);
  expect(testo.trim().length).toBeGreaterThan(0);
});

// ── 5. Nessun verde acceso a vuoto ──────────────────────────────────────────

const SENZA_DOMANDE = [
  ['in coda con un motivo rimasto appeso', { status: 'todo', statusReason: 'clarify' }],
  ['ferma sul giudizio', { status: 'design', statusReason: 'judges' }],
  ['ferma sul giro a vuoto', { status: 'design', statusReason: 'loop' }],
  ['archiviata', { status: 'archived', statusReason: null }],
  ['risolta', { status: 'done', statusReason: null }],
];

for (const [nome, over] of SENZA_DOMANDE) {
  test(`pratica ${nome}: niente casella e niente rombo verde`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    const fb = pratica(Object.assign({ _id: `fb-g2-no-${nome.replace(/\s/g, '-')}` }, over));
    await apri(page, { fbs: [fb] });
    await apriDettaglio(page, fb);

    expect(await casella(page)).toBe(false);
    const r = await rombo(page);
    expect(r.esito).not.toBe('domande');
    expect(r.verde).toBe(false);
  });
}

// ── 6. Sotto-pratica ────────────────────────────────────────────────────────

test('sotto-pratica in attesa di risposta: casella e rombo verde come sulla madre', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-g2-figlia', seq: 902, subSeq: 3 });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);

  expect(await casella(page)).toBe(true);
  expect((await rombo(page)).verde).toBe(true);
});

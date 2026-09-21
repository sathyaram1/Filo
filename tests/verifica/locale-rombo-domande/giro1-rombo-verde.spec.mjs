// VERIFICA LOCALE, giro 1 — il rombo della fila delle forme quando una
// segnalazione aspetta una risposta dell'owner.
//
// Scritta da fuori, dal solo sintomo: in Gestione, sul dettaglio di una
// segnalazione dove compare la casella «Rispondi alle domande di Filo», il
// rombo deve essere VERDE (una segnalazione c'è: le domande). Finora su
// alcune pratiche era grigio.
//
// L'invariante che provo, più forte del caso singolo:
//   casella della risposta visibile  ⟺  rombo verde e cliccabile con dentro
//   le domande; casella assente ⟺ rombo grigio.
//
// Il canale verso il main è sostituito (stesso schema delle altre prove):
// il codice vero di lettura e disegno gira.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-dom-001',
    text: 'Il tasto destro sulle immagini non offre «Salva».',
    name: 'Salva immagine dal tasto destro',
    seq: 901,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-18T10:00:00Z',
    images: [],
    status: 'design',
    statusReason: 'clarify',
    statusPublic: 'open',
    notes: 'Quale immagine intendi: quella di sfondo o quelle dentro la pagina?',
  }, over);
}

// Una conversazione già andata avanti: Filo chiede, l'owner risponde, Filo
// richiede. L'ultima domanda è quella che conta.
const CONVERSAZIONE = [
  'Quale immagine intendi?',
  '--- La tua risposta del 19/09/2026, 10:00 ---',
  'Quelle dentro la pagina.',
  '--- Filo ha risposto il 19/09/2026, 11:00 ---',
  'Anche sulle immagini di sfondo delle pagine con parallasse?',
].join('\n');

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

/** Com'è il rombo adesso: classi, esito, titolo, colore vero sullo schermo. */
async function rombo(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#mgForme [data-livello="l3"]');
    if (!el) return null;
    const cs = getComputedStyle(el.querySelector('svg path') || el);
    return {
      classe: el.className,
      esito: el.dataset.esito,
      titolo: el.title,
      vuoto: el.classList.contains('mg-forma--vuota'),
      verde: el.classList.contains('mg-forma--design'),
      riempimento: cs.fill,
      opacita: getComputedStyle(el).opacity,
    };
  });
}

const cassettaVisibile = (page) => page.locator('#mgClarify').isVisible();

// ── 1. Il cammino segnalato ────────────────────────────────────────────────

test('domande aperte: la casella c\'è e il rombo è verde', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);

  expect(await cassettaVisibile(page)).toBe(true);
  await expect(page.locator('#mgClarifyText')).toHaveAttribute('placeholder', /Rispondi alle domande di Filo/);

  const r = await rombo(page);
  expect(r).not.toBeNull();
  expect(r.vuoto).toBe(false);
  expect(r.verde).toBe(true);

  // E cliccandolo dice DI COSA si tratta: le domande, non una scheda vuota.
  await page.locator('#mgForme [data-livello="l3"]').click();
  const pannello = await page.locator('#mgSide').innerText();
  expect(pannello).toMatch(/sfondo/);
});

test('la stessa pratica scritta alla vecchia maniera si comporta uguale', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-dom-legacy', status: 'clarify', statusReason: undefined });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);

  expect(await cassettaVisibile(page)).toBe(true);
  const r = await rombo(page);
  expect(r.vuoto).toBe(false);
  expect(r.verde).toBe(true);
});

// ── 2. L'invariante, su una batteria di pratiche ───────────────────────────

test('casella e rombo verde vanno sempre insieme, in tutti i casi provati', async ({ openTab }) => {
  const page = await openTab(MANAGE);

  const casi = [
    ['domande, forma nuova',            pratica({ _id: 'c1' })],
    ['domande, forma vecchia',          pratica({ _id: 'c2', status: 'clarify', statusReason: undefined })],
    ['domande senza conversazione',     pratica({ _id: 'c3', notes: '' })],
    ['domande, conversazione cifrata',  pratica({ _id: 'c4', notes: 'FENC:xxxxxxxxxxxx' })],
    ['domande lunghissime',             pratica({ _id: 'c5', notes: '--- Filo ---\n' + 'a'.repeat(10000) })],
    ['domande con HTML ostile',         pratica({ _id: 'c6', notes: '--- Filo ---\n<script>window.__bucato=1</script><img src=x onerror="window.__bucato=1">' })],
    ['niente domande (giudici)',        pratica({ _id: 'c7', status: 'design', statusReason: 'judges', notes: '' })],
    ['niente domande (in coda)',        pratica({ _id: 'c8', status: 'todo', statusReason: undefined, notes: '--- Filo ---\nDomanda vecchia, già risposta.' })],
    ['niente domande (risolta)',        pratica({ _id: 'c9', status: 'done', statusReason: undefined, notes: '' })],
  ];

  await apri(page, { fbs: casi.map(([, f]) => f) });

  const rotti = [];
  for (const [nome, fb] of casi) {
    await apriDettaglio(page, fb);
    const casella = await cassettaVisibile(page);
    const r = await rombo(page);
    if (casella !== (r && r.verde)) {
      rotti.push(`${nome}: casella ${casella ? 'visibile' : 'assente'}, rombo ${r && r.verde ? 'verde' : 'grigio'}`);
    }
  }
  expect(rotti, rotti.join(' | ')).toEqual([]);

  // Il testo ostile è finito nel pannello come TESTO, non come pagina.
  await apriDettaglio(page, casi.find(([n]) => n.includes('HTML'))[1]);
  await page.locator('#mgForme [data-livello="l3"]').click();
  expect(await page.evaluate(() => window.__bucato || null)).toBeNull();
  expect(await page.locator('#mgSide').innerText()).toMatch(/script/);
});

// ── 3. Dopo la risposta il verde se ne va ──────────────────────────────────

test('risposta inviata: la casella sparisce e il rombo torna grigio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-dom-risposta' });
  await apri(page, { fbs: [fb] });
  await apriDettaglio(page, fb);
  expect((await rombo(page)).verde).toBe(true);

  await page.locator('#mgClarifyText').fill('Intendo quelle dentro la pagina.');
  await page.locator('#mgClarifyBtn').click();
  await expect(page.locator('#mgDetail')).toBeHidden();
  expect(await page.evaluate(() => window.__inviati.length)).toBe(1);

  // Riaperta: niente più domande in sospeso, niente più verde.
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
  expect(await cassettaVisibile(page)).toBe(false);
  expect((await rombo(page)).verde).toBe(false);
});

// ── 4. Doppio clic e aperture ripetute ─────────────────────────────────────

test('aperture ripetute e doppio clic non spengono il rombo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = pratica({ _id: 'r1' });
  const b = pratica({ _id: 'r2', status: 'design', statusReason: 'judges', notes: '' });
  await apri(page, { fbs: [a, b] });

  for (let i = 0; i < 4; i++) {
    await apriDettaglio(page, a);
    expect((await rombo(page)).verde).toBe(true);
    await apriDettaglio(page, b);
    expect((await rombo(page)).verde).toBe(false);
  }

  await apriDettaglio(page, a);
  await page.locator('#mgForme [data-livello="l3"]').dblclick();
  expect((await rombo(page)).verde).toBe(true);
  await expect(page.locator('#mgSide')).toBeVisible();
});

// ── 5. Si vede? (tema chiaro e tema scuro) ─────────────────────────────────

test('il verde del rombo si distingue dal grigio nei due temi', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const verde = pratica({ _id: 't1' });
  const grigio = pratica({ _id: 't2', status: 'design', statusReason: 'judges', notes: '' });
  await apri(page, { fbs: [verde, grigio] });

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { window.SN_PAGE_BOOTSTRAP.applyTheme(t); }, tema);
    await apriDettaglio(page, verde);
    const v = await rombo(page);
    await apriDettaglio(page, grigio);
    const g = await rombo(page);
    expect(v.riempimento, `tema ${tema}`).not.toBe(g.riempimento);
    expect(v.riempimento, `tema ${tema}`).not.toMatch(/none/);

    // Traccia da guardare a occhio (cartella ignorata da git).
    await apriDettaglio(page, verde);
    await page.locator('#mgDetail').screenshot({ path: `tests/.shots/rombo-domande-${tema}.png` });
  }
});

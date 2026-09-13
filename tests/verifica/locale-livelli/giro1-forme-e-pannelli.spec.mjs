// VERIFICA LOCALE, giro 1 — la fila dei cinque livelli nella dashboard di
// gestione (triangolo, cerchi, rombo, pentagono, quadrato).
//
// Scritta da fuori, senza guardare il lavoro. Cosa deve essere vero per
// l'owner davanti alla scheda di una segnalazione:
//   1. niente più riga di stato né riga «Giudici»: al loro posto la fila delle
//      cinque forme, sempre nello stesso ordine e sempre della stessa lunghezza;
//      un livello senza parere è grigio e resta al suo posto, e cliccato dice
//      perché;
//   2. ogni forma cliccata apre le sue informazioni nel pannello di destra, con
//      un anello sulla forma scelta;
//   3. triangolo: blu / giallo / rosso a seconda del filtro d'ingresso;
//   4. rombo: la segnalazione di Claude (problema e scelte) si legge, anche se
//      lunga, anche se ostile (testo, mai HTML);
//   5. pentagono: l'audit di sicurezza; una bocciatura offre «Salta il
//      controllo» (due click, solo owner) e il quadrato resta;
//   6. quadrato: una richiesta di fusione ferma È la scheda bloccata a L5, coi
//      tasti Approva/Scarta dentro il pannello; in lista si riconosce e sta in
//      cima; nei Ricevuti non c'è più un blocco a parte con le richieste;
//   7. quando una pratica torna in Ricevuti dopo la coda, la domanda di design
//      (rombo) e i motivi di sicurezza (pentagono, triangolo) si ritrovano
//      senza scavare nel log;
//   8. aggiornamento continuo: un livello che arriva dopo si vede da solo;
//   9. stato cifrato: niente forme inventate.
//
// Il canale verso il main è sostituito (stesso schema delle prove dei giri
// passati): il codice vero di lettura e disegno gira.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function verdetto(judge, cls, extra = {}) {
  return Object.assign({ judge, class: cls, reasoning: `Ragionamento di ${judge}.`, model: `modello/${judge}` }, extra);
}

const GIUDICI = ['g1', 'g2', 'g3', 'g4'];

function pipelinePulita(over = {}) {
  return Object.assign({
    l1Category: 'clean',
    l1Reasons: [],
    action: 'human_review',
    expectedJudges: GIUDICI.slice(),
    verdicts: GIUDICI.map((g) => verdetto(g, 'aligned')),
    filoSummary: 'Sembra una richiesta sensata.',
  }, over);
}

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-liv-001',
    text: 'Il tasto destro sulle immagini non offre «Salva».',
    name: 'Salva immagine dal tasto destro',
    seq: 777,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-10T10:00:00Z',
    images: [],
    status: 'aligned',
    statusPublic: 'open',
    pipeline: pipelinePulita(),
  }, over);
}

/** Una richiesta di fusione ferma, come la manda il server. */
function richiesta(over = {}) {
  return Object.assign({
    id: 'req-0001-abcdef',
    branch: 'worker/salva-immagine',
    sha: 'c0ffee11'.repeat(5),
    who: 'resolver · notturna',
    origin: 'routine',
    num: '#777',
    feedbackId: 'fb-liv-001',
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['firestore.rules'], more: 0 },
    ],
    createdAtMs: Date.now() - 60 * 60 * 1000,
    expiresAtMs: Date.now() + 6 * 24 * 60 * 60 * 1000,
    expired: false,
    used: false,
    discarded: false,
  }, over);
}

async function apri(page, { admin = true, fbs = [], pending = [], failed = [], salta = { ok: true, esito: 'bloccato' } } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__calls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        return { ok: true, pending: cfg.pending, failed: cfg.failed, recent: [], preapproved: [], ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      if (t === 'merge_approval_approve' || t === 'merge_approval_discard') {
        window.__calls.push(msg);
        return { ok: true, result: t === 'merge_approval_approve' ? 'merged' : 'discarded', sha: 'deadbeef'.repeat(5) };
      }
      if (t === 'livello4_salta') {
        window.__calls.push(msg);
        return cfg.salta;
      }
      return orig(msg);
    };
  }, { admin, pending, failed, salta });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((fbs) => window.__mgTest.setData(fbs), fbs);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

async function vaiAllaScheda(page, fb) {
  await page.evaluate((f) => window.__mgTest.setTab(window.SN_MANAGE_REVIEW.manageTabFor(f, {})), fb);
}

async function apriDettaglio(page, fb) {
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
}

/** Le forme della fila, nell'ordine in cui stanno sullo schermo. */
async function fila(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#mgForme > *')) {
      if (el.classList.contains('mg-forme-gruppo')) {
        out.push({ tipo: 'cerchi', n: el.querySelectorAll('.mg-dot').length,
          classi: Array.from(el.querySelectorAll('.mg-dot')).map((d) => d.className) });
      } else {
        out.push({ tipo: el.dataset.livello, esito: el.dataset.esito, classe: el.className, titolo: el.title });
      }
    }
    return out;
  });
}

const forma = (page, key) => page.locator(`#mgForme .mg-forma[data-livello="${key}"]`);
const side = (page) => page.locator('#mgSide');
const sideTitle = (page) => page.locator('#mgSideTitle');
const sideBody = (page) => page.locator('#mgSideBody');

// ── 1. La fila: cinque livelli, sempre, nello stesso ordine ─────────────────

test('niente riga di stato né «Giudici»: cinque forme in fila, i livelli senza parere grigi e al loro posto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);

  const row = page.locator('#mgLivelliRow');
  await expect(row).toBeVisible();
  const f = await fila(page);
  expect(f.map((x) => x.tipo)).toEqual(['l1', 'cerchi', 'l3', 'l4', 'l5']);
  expect(f[1].n).toBe(4);
  // Triangolo blu (pulito), cerchi blu, gli altri tre grigi (nessun parere).
  expect(f[0].classe).toContain('mg-forma--aligned');
  for (const c of f[1].classi) expect(c).toContain('mg-dot--aligned');
  expect(f[2].classe).toContain('mg-forma--vuota');
  expect(f[3].classe).toContain('mg-forma--vuota');
  expect(f[4].classe).toContain('mg-forma--vuota');

  // La vecchia riga di stato e la vecchia riga «Giudici» non ci sono più.
  const detailText = await page.locator('#mgDetail').innerText();
  expect(detailText).not.toMatch(/^\s*Giudici\s*$/m);
  await expect(page.locator('#mgDetail .mg-state')).toHaveCount(0);
  await expect(page.locator('#mgDetail #mgJudges, #mgDetail .mg-judges-row, #mgDetail #mgStateBadge')).toHaveCount(0);

  // Ogni forma ha una o due parole sotto il puntatore.
  for (const key of ['l1', 'l3', 'l4', 'l5']) {
    const t = await forma(page, key).getAttribute('title');
    expect(String(t || '').trim().length).toBeGreaterThan(0);
  }
});

test('ogni forma cliccata apre il suo pannello a destra; un livello grigio dice perché; l’anello segue la scelta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await expect(side(page)).toBeHidden();

  // Triangolo.
  await forma(page, 'l1').click();
  await expect(side(page)).toBeVisible();
  await expect(sideTitle(page)).toHaveText(/filtro/i);
  await expect(sideBody(page)).toContainText(/pulito/i);
  await expect(forma(page, 'l1')).toHaveClass(/mg-forma--scelta/);
  expect(await page.evaluate(() => window.__mgTest.livelloAperto())).toBe('l1');

  // Un cerchio (giudice).
  await page.locator('#mgForme .mg-forme-gruppo .mg-dot').nth(1).click();
  await expect(sideTitle(page)).toHaveText('modello/g2');
  await expect(sideBody(page)).toContainText('Ragionamento di g2.');
  await expect(forma(page, 'l1')).not.toHaveClass(/mg-forma--scelta/);

  // Rombo grigio: dice perché.
  await forma(page, 'l3').click();
  await expect(sideTitle(page)).toHaveText(/segnalazione/i);
  await expect(sideBody(page)).toContainText(/nessuna segnalazione/i);
  await expect(forma(page, 'l3')).toHaveClass(/mg-forma--scelta/);

  // Pentagono grigio.
  await forma(page, 'l4').click();
  await expect(sideTitle(page)).toHaveText(/audit/i);
  await expect(sideBody(page)).toContainText(/non ancora fatto/i);
  await expect(page.locator('#mgSaltaL4Btn')).toHaveCount(0);

  // Quadrato grigio.
  await forma(page, 'l5').click();
  await expect(sideTitle(page)).toHaveText(/fusione/i);
  await expect(sideBody(page)).toContainText(/niente da fondere/i);
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--scelta/);
  await expect(page.locator('#mgForme .mg-forma--scelta')).toHaveCount(1);

  // Chiudere il pannello toglie l'anello.
  await page.locator('#mgSideClose').click();
  await expect(side(page)).toBeHidden();
  await expect(page.locator('#mgForme .mg-forma--scelta')).toHaveCount(0);

  // Click ripetuti in fretta: una forma sola resta scelta, il pannello è quello.
  await forma(page, 'l1').click();
  await forma(page, 'l5').click();
  await forma(page, 'l3').click();
  await forma(page, 'l4').click();
  await expect(page.locator('#mgForme .mg-forma--scelta')).toHaveCount(1);
  await expect(forma(page, 'l4')).toHaveClass(/mg-forma--scelta/);
  await expect(sideTitle(page)).toHaveText(/audit/i);

  // Da tastiera: le forme sono bottoni, Invio le apre.
  await forma(page, 'l1').focus();
  await page.keyboard.press('Enter');
  await expect(sideTitle(page)).toHaveText(/filtro/i);
});

// ── 2. Triangolo: blu / giallo / rosso ──────────────────────────────────────

test('triangolo: pulito blu, spam giallo, pericoloso rosso; senza traccia è grigio e dice lo stato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const pulita = pratica({ _id: 'p1', seq: 1 });
  const spam = pratica({ _id: 'p2', seq: 2, status: 'spam', pipeline: pipelinePulita({ l1Category: 'spam', l1Reasons: ['link_spam', 'flood'], action: 'block_spam', verdicts: GIUDICI.map((g) => verdetto(g, 'spam')) }) });
  const pericolosa = pratica({ _id: 'p3', seq: 3, status: 'attack', pipeline: pipelinePulita({ l1Category: 'dangerous', l1Reasons: ['prompt_injection', 'codice_ignoto_x'], action: 'block_attack', verdicts: GIUDICI.map((g) => verdetto(g, 'attack')) }) });
  const senzaTraccia = pratica({ _id: 'p4', seq: 4, status: 'design', statusReason: 'secaudit', pipeline: undefined });
  await apri(page, { fbs: [pulita, spam, pericolosa, senzaTraccia] });

  for (const [fb, classe, parola] of [[pulita, 'aligned', /pulito/i], [spam, 'spam', /spam/i], [pericolosa, 'attack', /pericoloso/i]]) {
    await vaiAllaScheda(page, fb);
    await apriDettaglio(page, fb);
    await expect(forma(page, 'l1')).toHaveClass(new RegExp(`mg-forma--${classe}`));
    await forma(page, 'l1').click();
    await expect(sideBody(page)).toContainText(parola);
  }
  // I motivi si leggono in italiano; un codice sconosciuto si legge lo stesso.
  await expect(sideBody(page)).toContainText(/iniezione di istruzioni/i);
  await expect(sideBody(page)).toContainText(/codice ignoto x/i);

  await vaiAllaScheda(page, senzaTraccia);
  await apriDettaglio(page, senzaTraccia);
  await expect(forma(page, 'l1')).toHaveClass(/mg-forma--vuota/);
  await forma(page, 'l1').click();
  await expect(sideBody(page)).toContainText(/non ha lasciato traccia/i);
  // …ma la decisione presa (bloccato dalla sicurezza) si legge lo stesso qui.
  await expect(sideBody(page)).toContainText(/sicurezza/i);
});

// ── 3. Rombo: la segnalazione di Claude ─────────────────────────────────────

test('rombo: la segnalazione si legge per intero, come testo, anche lunga e ostile', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lungo = 'Scelta B: costa di più ma non chiude strade. '.repeat(220); // ~10.000 caratteri
  const testo = `## Problema\nIl tasto «Salva» sulle immagini: nome del file?\n<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>\n## Scelte\n- A: nome dal sito 🙂\n- B: chiede ogni volta\n${lungo}\n## Cosa ho fatto nel frattempo\nA.`;
  const fb = pratica({
    _id: 'fb-l3', seq: 12, status: 'design', statusReason: 'decisione',
    livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-13T09:15:00.000Z', testo } },
  });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  // Torna nei Ricevuti: è lì che l'owner la cerca.
  expect(await page.evaluate((f) => window.SN_MANAGE_REVIEW.manageTabFor(f, {}), fb)).toBe('inbox');
  await apriDettaglio(page, fb);

  await expect(forma(page, 'l3')).not.toHaveClass(/mg-forma--vuota/);
  await expect(forma(page, 'l3')).toHaveClass(/mg-forma--design/);
  await forma(page, 'l3').click();
  await expect(sideTitle(page)).toHaveText(/segnalazione/i);
  const body = sideBody(page);
  await expect(body).toContainText('Il tasto «Salva» sulle immagini: nome del file?');
  await expect(body).toContainText('chi ha scritto il fix');
  await expect(body).toContainText(/13\/09\/2026/);
  const txt = await body.innerText();
  expect(txt).toContain('<img src=x onerror="window.__xss=1">');
  expect(txt).toContain('B: chiede ogni volta');
  expect(txt).toContain('Cosa ho fatto nel frattempo');
  expect(txt.length).toBeGreaterThan(9000);
  await expect(body.locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  // Il pannello lungo scorre dentro di sé: la pagina non scorre in orizzontale.
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(overflowX).toBe(true);
});

test('rombo: segnalazione senza testo, o cifrata, si dice invece di tacere', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const vuota = pratica({ _id: 'v', seq: 21, livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', testo: '   ' } } });
  const cifrata = pratica({ _id: 'c', seq: 22, livelli: { l3: { esito: 'segnalato', ruolo: 'verifier', testo: 'FENC:abcdef0123456789abcdef' } } });
  await apri(page, { fbs: [vuota, cifrata] });
  await vaiAllaScheda(page, vuota);
  await apriDettaglio(page, vuota);
  await forma(page, 'l3').click();
  await expect(sideBody(page)).toContainText(/senza testo/i);
  await expect(sideBody(page)).toContainText('chi ha verificato il fix');
  await apriDettaglio(page, cifrata);
  await forma(page, 'l3').click();
  await expect(sideBody(page)).toContainText(/cifrat/i);
  const t = await sideBody(page).innerText();
  expect(t).not.toContain('FENC:');
});

// ── 4. Pentagono: audit di sicurezza e «Salta il controllo» ─────────────────

test('pentagono bocciato: rosso, il resoconto si legge, «Salta il controllo» chiede conferma e manda il comando giusto; il quadrato resta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({
    _id: 'fb-l4', seq: 31, status: 'design', statusReason: 'secaudit',
    livelli: { l4: { esito: 'fail', by: 'secaudit', at: '2026-09-13T11:00:00.000Z', testo: 'Trovato: scrive nelle regole del database senza test. <b>ostile</b>' } },
  });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  expect(await page.evaluate((f) => window.SN_MANAGE_REVIEW.manageTabFor(f, {}), fb)).toBe('inbox');
  await apriDettaglio(page, fb);

  await expect(forma(page, 'l4')).toHaveClass(/mg-forma--attack/);
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--vuota/);
  await forma(page, 'l4').click();
  await expect(sideTitle(page)).toHaveText(/audit/i);
  await expect(sideBody(page)).toContainText(/bocciato/i);
  await expect(sideBody(page)).toContainText('scrive nelle regole del database senza test.');
  const t = await sideBody(page).innerText();
  expect(t).toContain('<b>ostile</b>');
  await expect(sideBody(page).locator('b')).toHaveCount(0);

  const btn = page.locator('#mgSaltaL4Btn');
  await expect(btn).toBeVisible();
  // Un click solo non basta.
  await btn.click();
  await expect(btn).toHaveText(/confermi/i);
  expect(await page.evaluate(() => window.__calls.length)).toBe(0);
  await btn.click();
  await expect(page.locator('#mgSideBody .mg-liv-esito')).toContainText(/via libera sul quadrato/i);
  const calls = await page.evaluate(() => window.__calls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ type: 'livello4_salta', feedbackId: 'fb-l4' });
  // Il toast racconta l'esito anche a chi ha chiuso il pannello.
  await expect(page.locator('#mgToast')).toContainText(/quadrato/i);
});

test('pentagono: passato verde senza tasto; saltato giallo; chi non è l’owner non vede «Salta»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const passato = pratica({ _id: 'ok', seq: 41, status: 'working', livelli: { l4: { esito: 'pass', by: 'secaudit', at: '2026-09-13T11:00:00.000Z', testo: 'Controllato: niente segreti, niente regole toccate.' } } });
  const saltato = pratica({ _id: 'sk', seq: 42, status: 'design', statusReason: 'l5', livelli: { l4: { esito: 'saltato', by: 'owner', at: '2026-09-13T11:30:00.000Z', testo: 'Trovato X.' } } });
  await apri(page, { fbs: [passato, saltato] });
  await vaiAllaScheda(page, passato);
  await apriDettaglio(page, passato);
  await expect(forma(page, 'l4')).toHaveClass(/mg-forma--design/);
  await forma(page, 'l4').click();
  await expect(sideBody(page)).toContainText('Controllato: niente segreti');
  await expect(page.locator('#mgSaltaL4Btn')).toHaveCount(0);
  // Lavoro in corso: il quadrato è giallo (in attesa), non grigio.
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--spam/);

  await vaiAllaScheda(page, saltato);
  await apriDettaglio(page, saltato);
  await expect(forma(page, 'l4')).toHaveClass(/mg-forma--spam/);
  await forma(page, 'l4').click();
  await expect(sideBody(page)).toContainText(/saltato/i);
  await expect(sideBody(page)).toContainText(/deciso da:?\s*te/i);
  await expect(page.locator('#mgSaltaL4Btn')).toHaveCount(0);
  // Fermo al cancello (dallo stato, senza richiesta arrivata): quadrato rosso.
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--attack/);
  await forma(page, 'l5').click();
  await expect(sideBody(page)).toContainText(/via libera/i);
});

test('chi non è l’owner non vede «Salta il controllo» né i tasti della fusione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'fb-l4', seq: 31, status: 'design', statusReason: 'secaudit', livelli: { l4: { esito: 'fail', by: 'secaudit', testo: 'Bocciato.' } } });
  await apri(page, { admin: false, fbs: [fb], pending: [richiesta({ feedbackId: 'fb-l4', num: '#31' })] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await forma(page, 'l4').click();
  await expect(sideBody(page)).toContainText(/bocciato/i);
  await expect(page.locator('#mgSaltaL4Btn')).toHaveCount(0);
  await forma(page, 'l5').click();
  await expect(sideBody(page).locator('button', { hasText: /approva/i })).toHaveCount(0);
});

test('pentagono grigio su una pratica vecchia bloccata dalla sicurezza: «Salta» c’è lo stesso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _id: 'old', seq: 51, status: 'design', statusReason: 'secaudit' });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await expect(forma(page, 'l4')).toHaveClass(/mg-forma--vuota/);
  await forma(page, 'l4').click();
  await expect(page.locator('#mgSaltaL4Btn')).toBeVisible();
  // Il triangolo dice la decisione presa.
  await forma(page, 'l1').click();
  await expect(sideBody(page)).toContainText(/bloccato dalla sicurezza/i);
});

// ── 5. Quadrato: la richiesta di fusione è la scheda bloccata a L5 ──────────

test('quadrato: la richiesta ferma si vede sulla scheda (rosso, badge, in cima) e si approva dal pannello; nei Ricevuti nessun blocco a parte', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const altra = pratica({ _id: 'altra', seq: 700, createdAt: '2026-09-12T10:00:00Z' });
  const ferma = pratica({ _id: 'fb-liv-001', seq: 777, status: 'design', statusReason: 'l5', createdAt: '2026-09-01T10:00:00Z' });
  const perNumero = pratica({ _id: 'num-only', seq: 778, createdAt: '2026-09-02T10:00:00Z' });
  await apri(page, {
    fbs: [altra, ferma, perNumero],
    pending: [richiesta(), richiesta({ id: 'req-0002', feedbackId: '', num: '#778', branch: 'worker/per-numero' })],
  });
  await page.locator('.mg-tab[data-tab="inbox"]').click();

  // Nessun blocco di richieste in alto: le richieste vivono nelle schede.
  await expect(page.locator('#panel-inbox .mg-merge-approvals, #mgMergeApprovals')).toHaveCount(0);
  const items = page.locator('.mg-item');
  await expect(items).toHaveCount(3);
  const ordine = await page.evaluate(() => window.__mgTest.currentOrder());
  expect(ordine.slice(0, 2).sort()).toEqual(['fb-liv-001', 'num-only']);
  await expect(items.filter({ hasText: '#777' }).locator('.mg-fusione-badge')).toBeVisible();
  await expect(items.filter({ hasText: '#778' }).locator('.mg-fusione-badge')).toBeVisible();
  await expect(items.filter({ hasText: '#700' }).locator('.mg-fusione-badge')).toHaveCount(0);

  await apriDettaglio(page, ferma);
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--attack/);
  await forma(page, 'l5').click();
  await expect(sideTitle(page)).toHaveText(/fusione/i);
  await expect(sideBody(page)).toContainText('worker/salva-immagine');
  await expect(sideBody(page)).toContainText(/Tocca aree protette/);
  const approva = sideBody(page).locator('button.sn-mac-btn-go').first();
  await expect(approva).toBeVisible();
  await expect(approva).toHaveText(/approva/i);
  await expect(sideBody(page).locator('button', { hasText: /scarta/i }).first()).toBeVisible();
  // Due click: il primo arma («Confermi?»), il secondo manda.
  await approva.click();
  await expect(approva).toHaveText(/confermi/i);
  expect(await page.evaluate(() => window.__calls.length)).toBe(0);
  await approva.click();
  await expect.poll(async () => page.evaluate(() => window.__calls.map((c) => c.type))).toContain('merge_approval_approve');
  const call = await page.evaluate(() => window.__calls.find((c) => c.type === 'merge_approval_approve'));
  expect(call.id).toBe('req-0001-abcdef');

  // La richiesta legata solo per numero: stessa cosa.
  await apriDettaglio(page, perNumero);
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--attack/);
  await forma(page, 'l5').click();
  await expect(sideBody(page)).toContainText('worker/per-numero');

  // In Automazioni non compaiono come orfane: hanno una scheda.
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#mgMergeApprovalsOrphans')).toBeHidden();
});

test('una richiesta senza segnalazione resta visibile in Automazioni', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, { fbs: [fb], pending: [richiesta({ id: 'orf', feedbackId: '', num: '', branch: 'claude/locale-senza-numero' })] });
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const orf = page.locator('#mgMergeApprovalsOrphans');
  await expect(orf).toBeVisible();
  await expect(orf).toContainText('claude/locale-senza-numero');
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('.mg-item .mg-fusione-badge')).toHaveCount(0);
});

test('una fusione approvata ma non avvenuta (conflitto) pesa come una ferma', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ status: 'design', statusReason: 'l5' });
  await apri(page, { fbs: [fb], failed: [richiesta({ used: true, outcome: 'conflict' })] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--attack/);
  await forma(page, 'l5').click();
  await expect(sideBody(page)).toContainText(/non è avvenuta/i);
  await expect(page.locator('.mg-item .mg-fusione-badge')).toHaveCount(1);
});

test('la richiesta ferma su una pratica ancora «in lavorazione»: in quale sezione si trova', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ status: 'working' });
  await apri(page, { fbs: [fb], pending: [richiesta()] });
  const tab = await page.evaluate((f) => window.SN_MANAGE_REVIEW.manageTabFor(f, {}), fb);
  // Traccia per la critica: dove finisce una fusione ferma se lo stato non è
  // stato aggiornato dal server.
  console.log('[verifica] fusione ferma su working → sezione:', tab);
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  const inInbox = await page.locator('.mg-item').count();
  console.log('[verifica] schede nei Ricevuti:', inInbox);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
  await expect(page.locator('.mg-item .mg-fusione-badge')).toHaveCount(1);
  await apriDettaglio(page, fb);
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--attack/);
});

// ── 6. Chiusa: quadrato verde e versione ────────────────────────────────────

test('pratica fusa: quadrato verde con la versione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ status: 'done', statusPublic: 'closed', resolvedInVersion: '1.2.3' });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--design/);
  await forma(page, 'l5').click();
  await expect(sideBody(page)).toContainText('1.2.3');
});

// ── 7. Aggiornamento continuo ───────────────────────────────────────────────

test('un livello che arriva dopo (segnalazione, richiesta di fusione) si vede da solo sulla scheda aperta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1', status: 'working' });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await expect(forma(page, 'l3')).toHaveClass(/mg-forma--vuota/);
  await forma(page, 'l3').click();
  await expect(sideBody(page)).toContainText(/nessuna segnalazione/i);

  const conL3 = pratica({ _updateTime: 't2', status: 'design', statusReason: 'decisione', livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-13T12:00:00.000Z', testo: 'Domanda arrivata dopo.' } } });
  await page.evaluate((doc) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => [{ _id: doc._id, _updateTime: 't2' }],
      getMany: async () => [doc],
    });
  }, conL3);
  const r = await page.evaluate(() => window.__mgTest.pollNow());
  expect(r.changed).toBe(1);
  await expect(forma(page, 'l3')).toHaveClass(/mg-forma--design/);
  // Traccia per la critica: il pannello aperto sul rombo resta aperto e si
  // aggiorna, o si chiude?
  const aperto = await side(page).isVisible();
  const livello = await page.evaluate(() => window.__mgTest.livelloAperto());
  console.log('[verifica] dopo l’aggiornamento: pannello visibile =', aperto, ', livello aperto =', livello);
  await forma(page, 'l3').click();
  await expect(sideBody(page)).toContainText('Domanda arrivata dopo.');

  // Arriva una richiesta di fusione dal campanello del main.
  await page.evaluate(() => {
    const orig = window.filo.message;
    window.filo.message = async (msg) => (msg && msg.type === 'merge_approvals_get')
      ? { ok: true, pending: [{ id: 'late', branch: 'worker/tardi', sha: 'ab'.repeat(20), who: 'x', origin: 'routine', num: '#777', feedbackId: 'fb-liv-001', blocks: [], createdAtMs: Date.now(), expiresAtMs: Date.now() + 1e8, expired: false, used: false, discarded: false }], failed: [], recent: [], preapproved: [], ttlMs: 1 }
      : orig(msg);
  });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--attack/);
  // La pratica, con l'aggiornamento, è passata nei Ricevuti: la si guarda lì.
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('.mg-item .mg-fusione-badge')).toHaveCount(1);
});

// ── 8. Stato cifrato: niente forme inventate ────────────────────────────────

test('stato cifrato: al posto delle forme solo «aperta/chiusa»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ status: 'FENC:0123456789abcdef0123456789abcdef', statusPublic: 'open' });
  await apri(page, { fbs: [fb] });
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgForme .mg-forma')).toHaveCount(0);
  await expect(page.locator('#mgForme .mg-dot')).toHaveCount(0);
  await expect(page.locator('#mgForme .mg-state')).toBeVisible();
});

// ── 9. Tema scuro e chiaro: le catture ──────────────────────────────────────

test('tema scuro e chiaro: catture della fila e dei pannelli', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({
    _id: 'fb-liv-001', status: 'design', statusReason: 'l5',
    pipeline: pipelinePulita({ verdicts: [verdetto('g1', 'aligned'), verdetto('g2', 'design'), verdetto('g3', 'spam')] }),
    livelli: {
      l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-13T09:15:00.000Z', testo: '## Problema\nDue strade.\n## Scelte\n- A\n- B' },
      l4: { esito: 'fail', by: 'secaudit', at: '2026-09-13T11:00:00.000Z', testo: 'Bocciato: tocca le regole.' },
    },
  });
  await apri(page, { fbs: [fb], pending: [richiesta()] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await forma(page, 'l4').click();
    await expect(page.locator('#mgSaltaL4Btn')).toBeVisible();
    await page.screenshot({ path: `tests/.shots/livelli-pentagono-${scheme}.png` });
    await forma(page, 'l5').click();
    await expect(sideBody(page).locator('button', { hasText: /approva/i }).first()).toBeVisible();
    await page.screenshot({ path: `tests/.shots/livelli-quadrato-${scheme}.png` });
    await forma(page, 'l3').click();
    await page.screenshot({ path: `tests/.shots/livelli-rombo-${scheme}.png` });
  }
  // Le forme grigie e colorate hanno un colore leggibile sul tema scuro:
  // il colore calcolato non è quello del fondo.
  const colori = await page.evaluate(() => Array.from(document.querySelectorAll('#mgForme .mg-forma')).map((el) => getComputedStyle(el).color));
  console.log('[verifica] colori forme (dark):', colori.join(' | '));
});

// VERIFICA LOCALE, giro 2 — la fila dei cinque livelli nella dashboard di
// gestione. Ri-prova le porte del giro 1 e ne cerca di nuove.
//
// Porte del giro 1 da tenere chiuse:
//   A. il pannello aperto su un livello NON si chiude quando l'aggiornamento
//      continuo ridisegna la stessa pratica: resta sulla forma scelta, si
//      riempie coi dati nuovi e tiene il punto di scorrimento; un
//      aggiornamento di un'ALTRA pratica non lo tocca;
//   B. nel rombo (e nel pentagono) i titoli «## …» e le voci «- …» del
//      markdown si leggono come titoli e voci, non come simboli; niente HTML
//      dal testo; anche con a capo di Windows.
// Porte nuove:
//   C. scartare una fusione dal pannello del quadrato (due click, id giusto) e
//      il pannello resta aperto quando l'elenco delle fusioni cambia;
//   D. i cerchi dei giudici da tastiera e col nome sotto il puntatore; un
//      gruppo senza verdetti si clicca e dice perché;
//   E. un filtro d'ingresso con una categoria che il client non conosce non
//      rompe la fila;
//   F. chi non è l'owner apre il quadrato di una fusione ferma e legge una
//      spiegazione, non un pannello vuoto;
//   G. il numero sulla linguetta e le schede nella lista dicono la stessa cosa
//      quando una fusione ferma sposta una pratica.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function verdetto(judge, cls, extra = {}) {
  return Object.assign({ judge, class: cls, reasoning: `Ragionamento di ${judge}.`, model: `modello/${judge}` }, extra);
}
const GIUDICI = ['g1', 'g2', 'g3', 'g4'];
function pipelinePulita(over = {}) {
  return Object.assign({
    l1Category: 'clean', l1Reasons: [], action: 'human_review',
    expectedJudges: GIUDICI.slice(),
    verdicts: GIUDICI.map((g) => verdetto(g, 'aligned')),
    filoSummary: 'Sembra una richiesta sensata.',
  }, over);
}
function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-liv-001', text: 'Il tasto destro sulle immagini non offre «Salva».',
    name: 'Salva immagine dal tasto destro', seq: 777, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-09-10T10:00:00Z', images: [],
    status: 'aligned', statusPublic: 'open', pipeline: pipelinePulita(),
  }, over);
}
function richiesta(over = {}) {
  return Object.assign({
    id: 'req-0001-abcdef', branch: 'worker/salva-immagine', sha: 'c0ffee11'.repeat(5),
    who: 'resolver · notturna', origin: 'routine', num: '#777', feedbackId: 'fb-liv-001',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 3600e3, expiresAtMs: Date.now() + 6 * 86400e3,
    expired: false, used: false, discarded: false,
  }, over);
}

async function apri(page, { admin = true, fbs = [], pending = [], failed = [] } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__calls = [];
    window.__fusioni = { pending: cfg.pending, failed: cfg.failed };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        return { ok: true, pending: window.__fusioni.pending, failed: window.__fusioni.failed, recent: [], preapproved: [], ttlMs: 7 * 86400e3 };
      }
      if (t === 'merge_approval_approve' || t === 'merge_approval_discard') {
        window.__calls.push(msg);
        return { ok: true, result: t === 'merge_approval_approve' ? 'merged' : 'discarded', sha: 'deadbeef'.repeat(5) };
      }
      if (t === 'livello4_salta') { window.__calls.push(msg); return { ok: true, esito: 'bloccato' }; }
      return orig(msg);
    };
  }, { admin, pending, failed });
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
async function aggiornaDalVivo(page, docs) {
  await page.evaluate((docs) => {
    window.__mgTest.setLiveSources({
      listVersions: async () => docs.map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
      getMany: async () => docs,
    });
  }, docs);
  return page.evaluate(() => window.__mgTest.pollNow());
}
const forma = (page, key) => page.locator(`#mgForme .mg-forma[data-livello="${key}"]`);
const cerchio = (page, i) => page.locator('#mgForme .mg-forme-gruppo .mg-dot').nth(i);
const side = (page) => page.locator('#mgSide');
const sideTitle = (page) => page.locator('#mgSideTitle');
const sideBody = (page) => page.locator('#mgSideBody');

// ── A. Il pannello resta aperto sull'aggiornamento continuo ────────────────

test('porta A: il rombo aperto resta aperto, si riempie da solo e tiene il punto di scorrimento quando la pratica si aggiorna', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const lungo = Array.from({ length: 300 }, (_, i) => `Riga ${i + 1} della segnalazione, abbastanza lunga da far scorrere il pannello.`).join('\n');
  const prima = pratica({ _updateTime: 't1', status: 'design', statusReason: 'decisione',
    livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-13T09:15:00.000Z', testo: `## Problema\nPrima versione.\n${lungo}` } } });
  await apri(page, { fbs: [prima] });
  await vaiAllaScheda(page, prima);
  await apriDettaglio(page, prima);
  await forma(page, 'l3').click();
  await expect(sideBody(page)).toContainText('Prima versione.');

  // L'owner scorre a metà e legge.
  const scroller = await page.evaluate(() => {
    const cands = [document.getElementById('mgSideBody'), document.getElementById('mgSide')];
    for (const el of cands) { if (el && el.scrollHeight > el.clientHeight + 50) { el.scrollTop = 400; return { id: el.id, top: el.scrollTop }; } }
    return null;
  });
  expect(scroller, 'il pannello lungo scorre dentro di sé').not.toBeNull();
  expect(scroller.top).toBeGreaterThan(100);

  // Arriva una nota della routine sulla stessa pratica: la segnalazione cambia.
  const dopo = Object.assign({}, prima, { _updateTime: 't2', livelli: { l3: Object.assign({}, prima.livelli.l3, { testo: `## Problema\nSeconda versione.\n${lungo}` }) } });
  const r = await aggiornaDalVivo(page, [dopo]);
  expect(r.changed).toBe(1);

  await expect(side(page)).toBeVisible();
  expect(await page.evaluate(() => window.__mgTest.livelloAperto())).toBe('l3');
  await expect(forma(page, 'l3')).toHaveClass(/mg-forma--scelta/);
  await expect(page.locator('#mgForme .mg-forma--scelta')).toHaveCount(1);
  await expect(sideBody(page)).toContainText('Seconda versione.');
  await expect(sideBody(page)).not.toContainText('Prima versione.');
  const topDopo = await page.evaluate((id) => document.getElementById(id).scrollTop, scroller.id);
  expect(Math.abs(topDopo - scroller.top)).toBeLessThan(40);
});

test('porta A: il pannello di un giudice resta su quel giudice; una forma grigia che si colora resta aperta; un aggiornamento di un’altra pratica non tocca il pannello', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const a = pratica({ _id: 'A', seq: 1, _updateTime: 'a1', status: 'working' });
  const b = pratica({ _id: 'B', seq: 2, _updateTime: 'b1', status: 'working' });
  await apri(page, { fbs: [a, b] });
  await vaiAllaScheda(page, a);
  await apriDettaglio(page, a);

  // Giudice g2 aperto; arriva un nuovo ragionamento dello stesso giudice.
  await cerchio(page, 1).click();
  await expect(sideTitle(page)).toHaveText('modello/g2');
  const a2 = Object.assign({}, a, { _updateTime: 'a2', pipeline: pipelinePulita({ verdicts: GIUDICI.map((g) => verdetto(g, 'aligned', { reasoning: `Nuovo ragionamento di ${g}.` })) }) });
  expect((await aggiornaDalVivo(page, [a2, b])).changed).toBe(1);
  await expect(side(page)).toBeVisible();
  await expect(sideTitle(page)).toHaveText('modello/g2');
  await expect(sideBody(page)).toContainText('Nuovo ragionamento di g2.');

  // Pentagono grigio aperto («non ancora fatto»); arriva l'audit: si colora e
  // il pannello mostra il resoconto senza ricliccare.
  await forma(page, 'l4').click();
  await expect(sideBody(page)).toContainText(/non ancora fatto/i);
  const a3 = Object.assign({}, a2, { _updateTime: 'a3', status: 'design', statusReason: 'secaudit',
    livelli: { l4: { esito: 'fail', by: 'secaudit', at: '2026-09-13T11:00:00.000Z', testo: 'Bocciato: tocca le regole.' } } });
  expect((await aggiornaDalVivo(page, [a3, b])).changed).toBe(1);
  await expect(forma(page, 'l4')).toHaveClass(/mg-forma--attack/);
  await expect(forma(page, 'l4')).toHaveClass(/mg-forma--scelta/);
  await expect(sideBody(page)).toContainText('Bocciato: tocca le regole.');
  await expect(page.locator('#mgSaltaL4Btn')).toBeVisible();

  // Cambia solo B: il pannello di A non si muove.
  const b2 = Object.assign({}, b, { _updateTime: 'b2', livelli: { l3: { esito: 'segnalato', ruolo: 'resolver', testo: 'Domanda su B.' } } });
  expect((await aggiornaDalVivo(page, [a3, b2])).changed).toBe(1);
  await expect(side(page)).toBeVisible();
  await expect(sideBody(page)).toContainText('Bocciato: tocca le regole.');
  await expect(sideBody(page)).not.toContainText('Domanda su B.');
  expect(await page.evaluate(() => window.__mgTest.livelloAperto())).toBe('l4');

  // Cambiando pratica, invece, il pannello si chiude (era di un'altra).
  await apriDettaglio(page, b2);
  await expect(side(page)).toBeHidden();
  await expect(page.locator('#mgForme .mg-forma--scelta')).toHaveCount(0);
});

// ── B. Markdown: titoli e voci come tali ────────────────────────────────────

test('porta B: nel rombo «## Problema» è un titolo e «- A» una voce, anche con a capo di Windows; niente HTML dal testo; vale anche per il pentagono', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const testo = '## Problema\r\nIl nome del file: dal sito o chiesto?\r\n#nonTitolo resta testo\r\n\r\n## Scelte\r\n- A: dal sito <b>ostile</b>\r\n* B: chiede ogni volta\r\n1. C: entrambe\r\n\r\n### Cosa ho fatto nel frattempo\r\nA.\r\n';
  const fb = pratica({ _id: 'md', seq: 5, status: 'design', statusReason: 'decisione',
    livelli: {
      l3: { esito: 'segnalato', ruolo: 'resolver', at: '2026-09-13T09:15:00.000Z', testo },
      l4: { esito: 'fail', by: 'secaudit', at: '2026-09-13T11:00:00.000Z', testo: '## Trovato\r\n- scrive nelle regole\r\n- niente test' },
    } });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await forma(page, 'l3').click();
  const body = sideBody(page);
  const titoli = body.locator('.mg-liv-titolo');
  await expect(titoli).toHaveCount(3);
  await expect(titoli.nth(0)).toHaveText('Problema');
  await expect(titoli.nth(1)).toHaveText('Scelte');
  await expect(titoli.nth(2)).toHaveText('Cosa ho fatto nel frattempo');
  const voci = body.locator('ul li');
  await expect(voci).toHaveCount(3);
  await expect(voci.nth(0)).toHaveText('A: dal sito <b>ostile</b>');
  await expect(voci.nth(2)).toHaveText('C: entrambe');
  await expect(body.locator('b')).toHaveCount(0);
  const txt = await body.innerText();
  expect(txt).not.toMatch(/^\s*#{1,6}\s/m);
  expect(txt).not.toMatch(/^\s*[-*]\s/m);
  expect(txt).toContain('#nonTitolo resta testo');
  expect(txt).not.toContain('\r');
  // La sezione sotto un titolo si legge: il pannello non mangia il corpo.
  expect(txt).toContain('Il nome del file: dal sito o chiesto?');

  await forma(page, 'l4').click();
  await expect(sideBody(page).locator('.mg-liv-titolo')).toHaveText(['Trovato']);
  await expect(sideBody(page).locator('ul li')).toHaveCount(2);
});

// ── C. Scartare dal quadrato; il pannello segue l'elenco delle fusioni ──────

test('porta C: «Scarta» dal pannello del quadrato manda il comando sull’id giusto (un click: si rifà gratis, come in Automazioni); quando la richiesta sparisce il pannello resta aperto e lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ status: 'design', statusReason: 'l5' });
  await apri(page, { fbs: [fb], pending: [richiesta()] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await forma(page, 'l5').click();
  const scarta = sideBody(page).locator('button', { hasText: /scarta/i }).first();
  await expect(scarta).toBeVisible();
  await scarta.click();
  await expect.poll(async () => page.evaluate(() => window.__calls.map((c) => c.type))).toContain('merge_approval_discard');
  const call = await page.evaluate(() => window.__calls.find((c) => c.type === 'merge_approval_discard'));
  expect(call.id).toBe('req-0001-abcdef');

  // Il server ora non ha più richieste ferme: la pagina rilegge l'elenco.
  await page.evaluate(() => { window.__fusioni = { pending: [], failed: [] }; });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(side(page)).toBeVisible();
  expect(await page.evaluate(() => window.__mgTest.livelloAperto())).toBe('l5');
  await expect(sideBody(page).locator('button', { hasText: /approva/i })).toHaveCount(0);
  await expect(sideBody(page).locator('button', { hasText: /scarta/i })).toHaveCount(0);
  const t = (await sideBody(page).innerText()).trim();
  expect(t.length).toBeGreaterThan(10);
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('.mg-item .mg-fusione-badge')).toHaveCount(0);
});

// ── D. I cerchi dei giudici: tastiera, nome, gruppo vuoto ───────────────────

test('porta D: i cerchi dei giudici si aprono con Invio, dicono il giudice sotto il puntatore; senza verdetti il gruppo spiega perché', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const piena = pratica({ _id: 'p', seq: 1 });
  const vuota = pratica({ _id: 'v', seq: 2, status: 'working', pipeline: pipelinePulita({ verdicts: [] }) });
  await apri(page, { fbs: [piena, vuota] });
  await vaiAllaScheda(page, piena);
  await apriDettaglio(page, piena);
  const c2 = cerchio(page, 1);
  expect(await c2.evaluate((el) => el.tagName)).toBe('BUTTON');
  expect(String(await c2.getAttribute('title') || '').length).toBeGreaterThan(0);
  await c2.focus();
  await page.keyboard.press('Enter');
  await expect(sideTitle(page)).toHaveText('modello/g2');
  await expect(sideBody(page)).toContainText('Ragionamento di g2.');

  await vaiAllaScheda(page, vuota);
  await apriDettaglio(page, vuota);
  const dots = page.locator('#mgForme .mg-forme-gruppo .mg-dot');
  await expect(dots).toHaveCount(4);
  await expect(dots.first()).toHaveClass(/mg-dot--empty/);
  await dots.first().click();
  await expect(side(page)).toBeVisible();
  const t = (await sideBody(page).innerText()).trim();
  expect(t.length).toBeGreaterThan(10);
});

// ── E. Categoria del filtro sconosciuta ─────────────────────────────────────

test('porta E: una categoria del filtro che il client non conosce non rompe la fila e il triangolo si apre lo stesso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ pipeline: pipelinePulita({ l1Category: 'nuova_categoria_x', l1Reasons: ['motivo_ignoto'], action: 'human_review' }) });
  await apri(page, { fbs: [fb] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  const f = await page.evaluate(() => Array.from(document.querySelectorAll('#mgForme > *')).map((el) => el.dataset.livello || 'cerchi'));
  expect(f).toEqual(['l1', 'cerchi', 'l3', 'l4', 'l5']);
  await forma(page, 'l1').click();
  await expect(side(page)).toBeVisible();
  const t = await sideBody(page).innerText();
  // Traccia per la critica: una categoria ignota si legge grezza o viene
  // presentata come un'altra? (Nel giro 2: «Pulito», triangolo blu.)
  const classe = await forma(page, 'l1').getAttribute('class');
  console.log('[verifica] categoria ignota → pannello:', t.split('\n').slice(0, 2).join(' '), '| classe:', classe);
  expect(t).toMatch(/motivo ignoto/i);
});

// ── F. Chi non è l'owner e il quadrato di una fusione ferma ─────────────────

test('porta F: chi non è l’owner apre il quadrato rosso e legge perché è fermo, senza tasti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ status: 'design', statusReason: 'l5' });
  await apri(page, { admin: false, fbs: [fb], pending: [richiesta()] });
  await vaiAllaScheda(page, fb);
  await apriDettaglio(page, fb);
  await expect(forma(page, 'l5')).toHaveClass(/mg-forma--attack/);
  await forma(page, 'l5').click();
  await expect(sideBody(page).locator('button')).toHaveCount(0);
  const t = (await sideBody(page).innerText()).trim();
  expect(t.length).toBeGreaterThan(10);
  expect(t).toMatch(/fusion|cancello|via libera/i);
});

// ── G. Linguetta e lista dicono lo stesso numero ────────────────────────────

test('porta G: il numero sulla linguetta dei Ricevuti conta anche la pratica portata lì da una fusione ferma', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const ferma = pratica({ _id: 'fb-liv-001', seq: 777, status: 'design', statusReason: 'l5' });
  const inCoda = pratica({ _id: 'q', seq: 778, status: 'working' });
  await apri(page, { fbs: [ferma, inCoda], pending: [richiesta()] });
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  const nellaLista = await page.locator('.mg-item').count();
  const sullaLinguetta = await page.evaluate(() => {
    const tab = document.querySelector('.mg-tab[data-tab="inbox"]');
    const b = tab && tab.querySelector('.mg-tab-count');
    return b ? b.textContent.trim() : (tab ? tab.textContent.replace(/\D/g, '') : '');
  });
  console.log('[verifica] Ricevuti: lista =', nellaLista, ', linguetta =', sullaLinguetta);
  expect(nellaLista).toBe(1);
  expect(String(sullaLinguetta)).toMatch(/^1\b/);
});

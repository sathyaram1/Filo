// Gestione: rosso e in cima solo una fusione che aspetta davvero l'owner (#1425, #1040.2); la riga dei tasti non
// chiude una pratica mentre la sua fusione aspetta (#928); quadrato, registro dei rifiuti e Log dicono il vero (#1327);
// la scheda della richiesta tiene il tempo, mostra la rotella e dice il ruolo in italiano (#1328). Pacchetto #1839.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const MIN = 60 * 1000;

function fb(id, seq, extra = {}) {
  return {
    _id: id, _updateTime: 't1', text: `Testo ${id}.`, name: `Titolo ${id}`,
    seq, subSeq: 0, clientId: 'tester@example.com', createdAt: `2026-09-${String(10 + (seq % 18)).padStart(2, '0')}T10:00:00Z`,
    images: [], statusPublic: 'open', ...extra,
  };
}
function richiesta(id, feedbackId, num, extra = {}) {
  return {
    id, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num),
    who: 'secaudit · notturna', origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'] }],
    createdAtMs: Date.now() - 5 * MIN, expiresAtMs: Date.now() + 24 * 60 * MIN, ...extra,
  };
}

async function apri(openTab, docs, liste, { approva = null } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, liste, approva }) => {
    window.__liste = liste;
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ...window.__liste };
      if (t === 'merge_approval_approve') {
        window.__chiamate.push(msg);
        // «mai»: il server non risponde, la fusione resta in volo.
        if (approva === 'mai') return new Promise(() => {});
        return approva || { ok: true, result: 'merged', sha: 'b'.repeat(40) };
      }
      if (t === 'update_feedback_status' || t === 'feedback_update_status') { window.__chiamate.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs, liste, approva });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  return page;
}

const scheda = (page, id) => page.locator(`.mg-item[data-id="${id}"]`);

// ── #1425 e #1040.2: rosso e in cima solo ciò che aspetta una decisione ─────

test('In coda: una fusione approvata in conflitto che la routine riallinea non è rossa né in cima; una da decidere sì', async ({ openTab }) => {
  const docs = [
    fb('riallinea', 1124, { status: 'revision_capability', createdAt: '2026-09-28T10:00:00Z' }),
    fb('decidere', 1125, { status: 'revision_security', createdAt: '2026-09-01T10:00:00Z' }),
    fb('fusa', 1126, { status: 'design', statusReason: 'l5', createdAt: '2026-09-29T10:00:00Z' }),
  ];
  const page = await apri(openTab, docs, {
    pending: [richiesta('p'.repeat(24), 'decidere', 1125)],
    failed: [richiesta('f'.repeat(24), 'riallinea', 1124, { used: true, outcome: 'conflict' })],
    recent: [richiesta('r'.repeat(24), 'fusa', 1126, { used: true, outcome: 'merged' })],
  });

  // La da riallineare resta In coda, senza rosso, con la sua etichetta.
  await apriScheda(page, 'queue');
  const riallinea = scheda(page, 'riallinea');
  await expect(riallinea).toBeVisible();
  await expect(riallinea).not.toHaveClass(/mg-item--fusione/);
  await expect(riallinea.locator('.mg-fusione-badge')).toHaveText('da riallineare');
  await expect(riallinea.locator('.mg-fusione-badge')).toHaveClass(/mg-fusione-badge--quieta/);
  expect(await riallinea.getAttribute('title')).toMatch(/la routine lo riallinea/);
  expect(await riallinea.getAttribute('title')).not.toMatch(/via libera/);
  await expect(riallinea.locator('.mg-segno-fermata')).toHaveCount(0);

  // Nei Ricevuti: la richiesta da decidere rossa e prima, l'approvata e fusa senza rosso e dopo.
  await apriScheda(page, 'inbox');
  const decidere = scheda(page, 'decidere');
  const fusa = scheda(page, 'fusa');
  await expect(decidere).toHaveClass(/mg-item--fusione/);
  await expect(decidere.locator('.mg-fusione-badge')).toHaveText('fusione ferma');
  await expect(fusa).toBeVisible();
  await expect(fusa).not.toHaveClass(/mg-item--fusione/);
  await expect(fusa.locator('.mg-fusione-badge')).not.toHaveText('fusione ferma');
  await expect(fusa.locator('.mg-segno-fermata')).not.toHaveClass(/mg-forma--attack/);
  // Il bordo non dice «bloccato»: rosso è solo la richiesta da decidere.
  const rosso = 'rgb(192, 57, 43)';
  expect(await fusa.evaluate((e) => getComputedStyle(e).borderLeftColor)).not.toBe(rosso);
  expect(await decidere.evaluate((e) => getComputedStyle(e).borderLeftColor)).toBe(rosso);
  expect(await fusa.getAttribute('title')).not.toMatch(/via libera/);
  const ordine = await page.locator('#mgList .mg-item').evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(ordine[0]).toBe('decidere');

  // Il pannello della fusione non avvenuta dice che la riallinea la routine, senza allarme.
  await page.evaluate(() => window.__mgTest.openDetail('riallinea'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const box = page.locator('#mgSideBody .sn-mac-failed');
  await expect(box).toHaveClass(/sn-mac-failed--in-corso/);
  await expect(box.locator('.sn-mac-title-text')).toHaveText('Una fusione approvata è da riallineare');
  await expect(box.locator('.sn-mac-why')).toContainText('torna da solo alla routine');
  await page.screenshot({ path: 'tests/.shots/fusioni-stato-riallinea.png' });
});

// ── #928: niente «Risolto» né altre chiusure mentre la fusione aspetta ──────

test('dettaglio: con una fusione da decidere o da riallineare la riga non chiude; i tasti della fusione stanno solo nel quadrato', async ({ openTab }) => {
  const docs = [
    fb('attesa', 773, { status: 'revision_security' }),
    fb('conflitto', 765, { status: 'working' }),
    fb('libera', 766, { status: 'working' }),
  ];
  const page = await apri(openTab, docs, {
    pending: [richiesta('a'.repeat(24), 'attesa', 773)],
    failed: [richiesta('c'.repeat(24), 'conflitto', 765, { used: true, outcome: 'conflict' })],
  });
  const riga = page.locator('#mgActionsRow');
  for (const id of ['attesa', 'conflitto']) {
    await page.evaluate((x) => window.__mgTest.openDetail(x), id);
    await expect(page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]')).toBeVisible();
    await expect(riga).not.toContainText('Risolto');
    await expect(riga).not.toContainText('Archivia');
    await expect(riga.locator('.sn-mac-btn')).toHaveCount(0);
  }
  // Senza fusioni in sospeso la riga è quella di sempre.
  await page.evaluate(() => window.__mgTest.openDetail('libera'));
  await expect(riga).toContainText('Risolto');
});

// ── #1327 punto 1: fusa col segno di un clic ─────────────────────────────────

test('quadrato: una fusione partita dal segno di un clic su Approva dice che viene dal tuo sì di prima', async ({ openTab }) => {
  const docs = [fb('segno', 743, { status: 'revision_security' })];
  const page = await apri(openTab, docs, {
    preapproved: [richiesta('d'.repeat(24), 'segno', 743, {
      used: true, outcome: 'merged', preapprovedBy: `owner@esempio.it · approvazione ${'e'.repeat(24)}`, preapprovedAt: '2026-10-01T10:00:00Z',
    })],
  });
  await page.evaluate(() => window.__mgTest.openDetail('segno'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const testo = page.locator('#mgSideBody .mg-liv-testo');
  await expect(testo).toContainText('col tuo sì a una richiesta precedente');
  await expect(testo).not.toContainText('avevi messo il segno');
});

// ── #1327 punti 2 e 3: registro dei rifiuti e Log ────────────────────────────

test('registro dei rifiuti: una frase per ogni motivo del server col dettaglio, e uno sconosciuto non resta un codice', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await apriScheda(page, 'log');
  const codici = await page.evaluate(() => Object.keys(window.SN_MANAGE_REVIEW.MOTIVI_RIFIUTO));
  const rifiuti = codici.map((reason, i) => ({
    id: `r${i}`, at: new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString(), slug: 'notturna', reason, detail: `dettaglio di ${i}`,
  })).concat([{ id: 'x', at: '2026-10-02T10:00:00.000Z', slug: 'notturna', reason: 'motivo_mai_visto', detail: 'qualcosa' }]);
  await page.evaluate((rej) => window.__mgTest.renderChannelLog(rej, []), rifiuti);
  const lista = page.locator('#mgChannelList');
  const prima = lista.locator('.mg-log-row').first();
  await expect(prima).toContainText('motivo che questa pagina non conosce (motivo_mai_visto)');
  await expect(prima.locator('.mg-log-dettaglio')).toHaveText('qualcosa');
  for (const r of rifiuti.slice(0, -1)) {
    const riga = lista.locator('.mg-log-row', { has: page.locator('.mg-log-dettaglio', { hasText: new RegExp(`^${r.detail}$`) }) });
    await expect(riga).toHaveCount(1);
    await expect(riga.locator('.mg-log-when')).not.toContainText(r.reason);
  }
});

test('Log: un cancelletto solo, che il numero lo porti o no', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderWorkerLog);
  await apriScheda(page, 'log');
  await page.evaluate(() => window.__mgTest.renderWorkerLog([
    { role: 'new-work', num: '#500', startedAt: new Date().toISOString() },
    { role: 'secaudit', num: '501', startedAt: new Date().toISOString() },
  ]));
  const righe = page.locator('#mgLogList .mg-log-row');
  await expect(righe.nth(0)).toContainText('· #500');
  await expect(righe.nth(1)).toContainText('· #501');
  await expect(righe.nth(1)).toContainText('Audit sicurezza');
  await expect(page.locator('#mgLogList')).not.toContainText('##');
});

// ── #1328: la scheda della richiesta ─────────────────────────────────────────

test('scheda: il tempo cammina da solo fino a «scaduta», senza perdere un «Confermi?» armato', async ({ openTab }) => {
  const docs = [fb('tempo', 487, { status: 'revision_security' })];
  const page = await openTab(URL);
  await page.clock.install();
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const ora = await page.evaluate(() => Date.now());
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs, req }) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [req], failed: [], recent: [], preapproved: [] };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs, req: richiesta('a'.repeat(24), 'tempo', 487, { createdAtMs: ora - MIN, expiresAtMs: ora + 2 * MIN + 8 * 1000 }) });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.openDetail('tempo'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const scadenza = page.locator('#mgSideBody .sn-mac-expiry');
  await expect(scadenza).toHaveText('scade fra 2 minuti');

  // Un clic armato resta armato mentre il tempo cammina.
  await page.clock.runFor(11 * 1000);
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await go.click();
  await expect(go).toHaveText('Confermi?');
  await page.clock.runFor(4 * 1000);
  await expect(scadenza).toHaveText('scade fra 1 minuto');
  await expect(go).toHaveText('Confermi?');

  await page.clock.runFor(3 * MIN);
  await expect(scadenza).toHaveText('scaduta');
  await expect(page.locator('#mgSideBody .sn-mac-card')).toHaveClass(/is-expired/);
});

test('scheda: in volo la rotella gira accanto a una frase leggibile; il ruolo si legge in italiano', async ({ openTab }) => {
  const docs = [fb('volo', 702, { status: 'revision_security' })];
  const page = await apri(openTab, docs, { pending: [richiesta('a'.repeat(24), 'volo', 702)] }, { approva: 'mai' });
  await page.evaluate(() => window.__mgTest.openDetail('volo'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const card = page.locator('#mgSideBody .sn-mac-card');
  await expect(card.locator('.sn-mac-who')).toHaveText('chiesta da Audit sicurezza · notturna');
  const go = card.locator('.sn-mac-btn-go');
  await go.click();
  await go.click();
  await expect(card).toHaveClass(/is-merging/);
  const stato = card.locator('.sn-mac-status');
  await expect(stato).toBeVisible();
  const vista = await stato.evaluate((el) => {
    const card = el.closest('.sn-mac-card');
    const tasto = card.querySelector('.sn-mac-btn-go');
    const prima = getComputedStyle(tasto, '::before');
    return {
      rotella: prima.content !== 'none' && prima.animationName === 'sn-mac-gira',
      tastoOpacita: getComputedStyle(tasto).opacity,
      colore: getComputedStyle(el).color,
      // Il ramo ha il colore del testo normale: la frase d'attesa deve avere lo stesso.
      testo: getComputedStyle(card.querySelector('.sn-mac-branch')).color,
      opacita: getComputedStyle(card).opacity,
    };
  });
  // #2250: in volo il tasto non somiglia a uno spento: rotella, «Sto fondendo», pieno di colore.
  expect(vista.rotella).toBe(true);
  expect(vista.tastoOpacita).toBe('1');
  expect(vista.opacita).toBe('1');
  expect(vista.colore).toBe(vista.testo);
  await expect(go).toBeDisabled();
  await expect(go).toHaveText('Sto fondendo');
  // Il tempo dal clic scorre da solo.
  const trascorso = stato.locator('.sn-mac-trascorso');
  await expect(trascorso).toHaveText(/^da \d+ s$/);
  const primo = await trascorso.textContent();
  await expect.poll(() => trascorso.textContent(), { timeout: 5_000 }).not.toBe(primo);
  await card.screenshot({ path: 'tests/.shots/fusioni-stato-volo-tasto.png' });
  // Il quadrato in cima dice quello che dicono lista e pannello: in volo non è più rosso «bloccato».
  await expect(scheda(page, 'volo')).toContainText('in fusione');
  await expect(page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]')).not.toHaveClass(/mg-forma--attack/);
  await expect(page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]')).toHaveClass(/mg-forma--scelta/);
  await page.screenshot({ path: 'tests/.shots/fusioni-stato-volo.png' });
});

// #2250: con un elenco lungo il tasto sta in fondo al pannello; la frase col tempo dal sì compare sotto e deve vedersi.
const vociLunghe = (n, p) => Array.from({ length: n }, (_, i) => ({ file: `src/${p}${i}.js`, riga: i + 1, testo: `exec('${p}-${i}');` }));
async function approvaInFondo(openTab) {
  const blocks = [
    { gate: 'g1', gruppo: 'capacita', label: 'Avvia un programma', voci: vociLunghe(13, 'a'), more: 0 },
    { gate: 'g2', gruppo: 'contenuto', label: 'Diff da leggere', voci: vociLunghe(27, 'b'), more: 0 },
  ];
  const page = await apri(openTab, [fb('lunga', 1867, { status: 'design', statusReason: 'l5' })],
    { pending: [richiesta('a'.repeat(24), 'lunga', 1867, { blocks })] }, { approva: 'mai' });
  await page.evaluate(() => window.__mgTest.openDetail('lunga'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-card .sn-mac-btn-go');
  await expect(go).toHaveText('Apri le 16 voci');
  await go.click();
  await expect(go).toHaveText('Approva e fondi');
  await page.locator('#mgSideBody').evaluate((n) => {
    for (let e = n; e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 1) e.scrollTop = e.scrollHeight;
  });
  await expect(go).toBeInViewport();
  await go.click();
  await go.click();
  await expect(go).toHaveText('Sto fondendo');
  return page;
}

test('scheda: approvata in fondo a un elenco lungo, la frase d’attesa col tempo dal sì viene in vista', async ({ openTab }) => {
  const page = await approvaInFondo(openTab);
  const trascorso = page.locator('#mgSideBody .sn-mac-card .sn-mac-trascorso');
  await expect(trascorso).toHaveText(/^da \d+ s$/);
  await expect(trascorso).toBeInViewport();
  await expect(page.locator('#mgSideBody .sn-mac-card .sn-mac-btn-go')).toBeInViewport();
});

test('scheda: chiuso e riaperto il pannello a metà volo, il tempo continua dal sì e non riparte da zero', async ({ openTab }) => {
  const page = await approvaInFondo(openTab);
  const trascorso = page.locator('#mgSideBody .sn-mac-card .sn-mac-trascorso');
  await expect(trascorso).toHaveText(/^da [3-9] s$/, { timeout: 8_000 });
  await page.evaluate(() => { document.querySelector('#mgSideBody .sn-mac-card').dataset.vecchia = '1'; });
  await page.locator('#mgSideClose, #mgSide [aria-label="Chiudi"], #mgSide .mg-side-close').first().click();
  await page.evaluate(() => window.__mgTest.openDetail('lunga'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  await expect(page.locator('#mgSideBody .sn-mac-card .sn-mac-btn-go')).toHaveText('Sto fondendo');
  // Una card nuova, disegnata a metà volo: non quella di prima rimasta lì.
  await expect(page.locator('#mgSideBody .sn-mac-card[data-vecchia]')).toHaveCount(0);
  const secondi = Number((await page.locator('#mgSideBody .sn-mac-card .sn-mac-trascorso').textContent()).match(/\d+/)[0]);
  expect(secondi).toBeGreaterThanOrEqual(3);
});

test('scheda: dopo un sì finito in conflitto dice che il giro parte da solo', async ({ openTab }) => {
  const docs = [fb('conf', 555, { status: 'revision_security' })];
  const page = await apri(openTab, docs, { pending: [richiesta('a'.repeat(24), 'conf', 555)] }, { approva: { ok: true, result: 'conflict' } });
  await page.evaluate(() => window.__mgTest.openDetail('conf'));
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]').click();
  const go = page.locator('#mgSideBody .sn-mac-btn-go');
  await go.click();
  await go.click();
  const stato = page.locator('#mgSideBody .sn-mac-status');
  await expect(stato).toContainText('torna da solo alla routine');
  await expect(stato).not.toContainText('serve un giro nuovo');
});

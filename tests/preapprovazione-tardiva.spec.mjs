// Il segno «fondi senza chiedermelo» messo DOPO il blocco: la richiesta che il
// server ha già aperto si fonde da Gestione, senza il click su «Approva e fondi».
// Il main è finto (canale sostituito): qui si prova cosa manda la pagina.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-tardiva-1',
    name: 'Le regole del database lasciano leggere i segreti',
    text: 'Segnalazione di sicurezza: tocca firestore.rules.',
    seq: 581, subSeq: 0,
    status: 'todo', statusPublic: 'open',
    clientId: 'tester@esempio',
    createdAt: '2026-09-13T08:00:00Z',
    images: [],
  }, over);
}

function richiesta(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'worker/fb-tardiva-1-20260920T081526Z',
    sha: SHA,
    who: 'secaudit · notturna',
    origin: 'routine',
    num: '#581',
    feedbackId: 'fb-tardiva-1',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 2 * 60 * 1000,
    expiresAtMs: Date.now() + GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

/** Il canale verso il main: proprietario; scritture e approvazioni registrate. */
async function stubMain(page, { pending = [], approveReply = null, approveReplies = null, updateReply = null, tieniInAttesa = false, ritardoMs = 0 } = {}) {
  await page.evaluate((cfg) => {
    window.__updates = [];
    window.__approvals = [];
    window.__fuse = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        // Il rifiuto arriva con calma: il tempo di cambiare pratica.
        if (cfg.updateReply) { await new Promise((r) => setTimeout(r, 1500)); return cfg.updateReply; }
        // Come il main: chi e quando del segno scritto.
        if (msg.mergePreapproved) { window.__segnoAt = new Date().toISOString(); return { ok: true, by: 'owner@esempio', at: window.__segnoAt }; }
        return { ok: true };
      }
      if (t === 'merge_approvals_get') {
        // Una fusione che NON è avvenuta lascia la richiesta dov'era: è il caso
        // del server irraggiungibile, non quello della fusione riuscita.
        const usate = cfg.tieniInAttesa ? new Set() : new Set(window.__fuse);
        return { ok: true, pending: cfg.pending.filter((r) => !usate.has(r.id)), failed: [], recent: [], preapproved: [], ttlMs: cfg.ttl };
      }
      if (t === 'merge_approval_approve') {
        window.__approvals.push(msg);
        // Il server scarica il diff, rifà i controlli e fonde: secondi, non millisecondi.
        if (cfg.ritardoMs) await new Promise((r) => setTimeout(r, cfg.ritardoMs));
        const reply = (cfg.approveReplies && cfg.approveReplies.shift()) || cfg.approveReply || { ok: true, result: 'merged', sha: cfg.sha };
        if (reply.ok) window.__fuse.push(msg.id);
        return reply;
      }
      return orig(msg);
    };
  }, { pending, approveReply, approveReplies, updateReply, tieniInAttesa, ritardoMs, sha: SHA, ttl: 7 * GIORNO });
}

async function apri(page, fbs, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, opts);
  await page.evaluate((list) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(list); }, fbs);
  await page.evaluate((tab) => window.__mgTest.setTab(tab), (opts && opts.tab) || 'queue');
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

const approvazioni = (page) => page.evaluate(() => window.__approvals.map((a) => a.id));

test('il segno messo con la richiesta già ferma la fonde subito, e lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb], { pending: [richiesta()] });
  expect(await approvazioni(page)).toEqual([]);

  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgPreapproveBtn').click();

  await expect(page.locator('#mgManageMsg')).toContainText('Da ora si fonde senza chiedere.');
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione ferma su questa pratica: Fatto: il lavoro è su main (a1b2c3d4)');
  expect(await approvazioni(page)).toEqual(['ab12cd34ef56ab12cd34ef56']);
  const updates = await page.evaluate(() => window.__updates);
  expect(updates).toEqual([{ type: 'feedback_update', id: fb._id, mergePreapproved: true }]);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
});

test('una richiesta ferma su una pratica già segnata parte da sola all’apertura, una volta sola', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T07:00:00.000Z' } });
  await apri(page, [fb], { pending: [richiesta()] });

  await expect.poll(() => approvazioni(page)).toEqual(['ab12cd34ef56ab12cd34ef56']);
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione ferma su #581, pratica segnata «fondi senza chiedermelo»: Fatto: il lavoro è su main');

  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  expect(await approvazioni(page)).toEqual(['ab12cd34ef56ab12cd34ef56']);
});

test('il segno non copre il lavoro locale, i blocchi nuovi dopo un riallineamento, una pratica senza segno o chiusa', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const segnata = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T07:00:00.000Z' } });
  const senzaSegno = pratica({ _id: 'fb-senza', seq: 582 });
  const chiusa = pratica({ _id: 'fb-chiusa', seq: 583, status: 'done', statusPublic: 'closed', mergePreapproved: { by: 'owner@esempio', at: '2026-09-01T00:00:00Z' } });
  const pending = [
    richiesta({ id: 'locale00000000000000000a', origin: 'locale', who: 'owner@esempio', branch: 'claude/mio-ramo' }),
    richiesta({ id: 'nuovi000000000000000000b', supersedes: 'c'.repeat(24) }),
    richiesta({ id: 'senza000000000000000000c', feedbackId: 'fb-senza', num: '#582', supersedes: 'd'.repeat(24) }),
    richiesta({ id: 'chiusa00000000000000000d', feedbackId: 'fb-chiusa', num: '#583' }),
  ];
  await apri(page, [segnata, senzaSegno, chiusa], { pending });
  await page.waitForTimeout(600);
  expect(await approvazioni(page)).toEqual([]);

  // Il segno messo adesso, con davanti la richiesta dei soli blocchi nuovi: la copre.
  await page.evaluate((id) => window.__mgTest.openDetail(id), senzaSegno._id);
  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione ferma su questa pratica: Fatto');
  expect(await approvazioni(page)).toEqual(['senza000000000000000000c']);
});

test('un segno respinto si vede anche se intanto hai aperto un’altra pratica', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const prima = pratica();
  const altra = pratica({ _id: 'fb-altra', seq: 582 });
  await apri(page, [prima, altra], { updateReply: { ok: false, error: 'firestore update fallito (403): PERMISSION_DENIED' } });
  await page.evaluate((id) => window.__mgTest.openDetail(id), prima._id);
  // Il click e subito l'altra pratica: la risposta arriva a scheda cambiata.
  await page.locator('#mgPreapproveBtn').click();
  await page.evaluate((id) => window.__mgTest.openDetail(id), altra._id);

  await expect(page.locator('#mgManageMsg')).toContainText('Segno non messo (#581): firestore update fallito (403)');
  await expect(page.locator('#mgManageMsg')).toHaveClass(/mg-err/);
  await expect(page.locator('.mg-item .mg-preapproved')).toHaveCount(0);
});

test('se il server non fonde, la pagina lo dice e non ritenta da sola', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb], { pending: [richiesta()], approveReply: { ok: false, error: 'github_no_token' } });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgPreapproveBtn').click();

  await expect(page.locator('#mgManageMsg')).toContainText('Il server non ha la credenziale con cui scrive: nessuna fusione è avvenuta.');
  await expect(page.locator('#mgManageMsg')).toHaveClass(/mg-err/);
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(400);
  expect(await approvazioni(page)).toEqual(['ab12cd34ef56ab12cd34ef56']);
});

// ── Il segno che arriva da fuori, e i tentativi che non riescono ───────────

test('il segno messo da fuori a pagina aperta fa partire il ramo fermo, senza riaprire Gestione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  const req = richiesta();
  await apri(page, [fb], { pending: [req] });
  expect(await approvazioni(page)).toEqual([]);

  // Lo script dell'owner, o un'altra finestra: la richiesta ferma è la stessa,
  // quindi nessuno avvisa la pagina delle fusioni. Deve bastare il segno.
  const conSegno = pratica({ _updateTime: 't2', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T10:00:00.000Z' } });
  await page.evaluate((doc) => window.__mgTest.setLiveSources({
    listVersions: async () => [{ _id: doc._id, _updateTime: 't2' }],
    getMany: async () => [doc],
  }), conSegno);
  await page.evaluate(() => window.__mgTest.pollNow());

  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
});

test('fusione non riuscita: rimettere il segno la ritenta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const req = richiesta();
  await apri(page, [fb], { pending: [req] });
  // Il primo tentativo non arriva al server; il secondo sì.
  await page.evaluate(() => {
    const prec = window.filo.message;
    let primo = true;
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'merge_approval_approve' && primo) {
        primo = false;
        window.__approvals.push(msg);
        return { ok: false, error: 'github_502 unreachable' };
      }
      return prec(msg);
    };
  });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  const btn = page.locator('#mgPreapproveBtn');
  await btn.click();
  await expect(page.locator('#mgManageMsg')).toContainText('riprova');
  expect(await approvazioni(page)).toHaveLength(1);

  await btn.click();
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await btn.click();
  await expect.poll(() => approvazioni(page).then((a) => a.length), { timeout: 8000 }).toBe(2);
  await expect(page.locator('#mgManageMsg')).toContainText('su main');
});

test('una fusione partita da sola che non riesce si legge anche senza pratica aperta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], approveReply: { ok: false, error: 'github_502 unreachable' } });
  await expect.poll(() => approvazioni(page).then((a) => a.length), { timeout: 8000 }).toBe(1);

  // Nessuna scheda aperta: il riquadro del dettaglio non è sullo schermo, e un
  // ramo che non è partito deve dirlo lo stesso.
  const toast = page.locator('#mgToast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('riprova');
});

test('due fusioni partite da sole nello stesso giro: si leggono tutte e due', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const segno = { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' };
  const uno = pratica({ mergePreapproved: segno });
  const due = pratica({ _id: 'fb-tardiva-2', seq: 582, name: 'Il terminale non ricorda la cartella', mergePreapproved: segno });
  const reqDue = richiesta({ id: 'bb22cc33dd44bb22cc33dd44', num: '#582', feedbackId: 'fb-tardiva-2', branch: 'worker/fb-tardiva-2' });
  await apri(page, [uno, due], {
    pending: [richiesta(), reqDue],
    approveReply: { ok: false, error: 'github_502 unreachable' },
    tieniInAttesa: true,
  });
  await expect.poll(() => approvazioni(page).then((a) => a.length), { timeout: 8000 }).toBe(2);

  // Il riquadro è uno solo: se gli esiti arrivano uno alla volta, il secondo
  // cancella il primo e quel ramo resta fermo senza che nessuno sappia perché.
  const toast = page.locator('#mgToast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Fusione ferma su #581');
  await expect(toast).toContainText('Fusione ferma su #582');
});

test('un tentativo non riuscito resta scritto sulla fusione ferma, dopo che l’avviso è passato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' } });
  await apri(page, [fb], {
    pending: [richiesta()],
    approveReply: { ok: false, error: 'github_502 unreachable' },
    tieniInAttesa: true,
  });
  await expect.poll(() => approvazioni(page).then((a) => a.length), { timeout: 8000 }).toBe(1);

  // L'owner arriva sulla pratica dopo: il perché dev'essere ancora lì, perché
  // quel ramo non riparte da solo.
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.evaluate((doc) => window.__mgTest.openSidebarLivello(doc, 'l5'), fb);
  const stato = page.locator('.sn-mac-card .sn-mac-status').first();
  await expect(stato).toBeVisible();
  await expect(stato).toContainText('riprova');
});

// ── La fusione mentre è in volo (#702) ─────────────────────────────────────

async function apriQuadrato(page, id) {
  await page.evaluate((fid) => window.__mgTest.openDetail(fid), id);
  await page.locator('.mg-forma[data-livello="l5"]').click();
}

test('fusione partita da sola e ancora in corso: la card lo dice, il tasto resta spento, l’esito arriva lì', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], ritardoMs: 5000 });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);

  await apriQuadrato(page, fb._id);
  const card = page.locator('#mgSideBody .sn-mac-card');
  const approva = card.locator('.sn-mac-btn-go');
  await expect(card.locator('.sn-mac-status')).toHaveText('Pratica segnata «fondi senza chiedermelo»: chiedo al server di fondere…');
  await expect(page.locator('#mgSideBody .sn-mac-title-text')).toHaveText('Una fusione in corso');
  await expect(approva).toBeDisabled();
  await expect(card.locator('.sn-mac-btn-quiet')).toBeDisabled();
  await page.screenshot({ path: 'tests/.shots/702-fusione-in-volo.png' });

  // Chiudere e riaprire il pannello non rimette in mano un tasto acceso.
  await page.locator('#mgSideClose').click();
  await page.locator('.mg-forma[data-livello="l5"]').click();
  await expect(approva).toBeDisabled();
  await expect(card.locator('.sn-mac-status')).toContainText('chiedo al server di fondere');

  await expect(card.locator('.sn-mac-status')).toContainText('Fatto: il lavoro è su main', { timeout: 10000 });
  expect(await approvazioni(page)).toEqual([req.id]);
});

test('«Approva e fondi» ancora in volo: il pannello riaperto non lo rilancia, e nemmeno il segno', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  const req = richiesta();
  await apri(page, [fb], { pending: [req], ritardoMs: 5000 });
  await apriQuadrato(page, fb._id);

  const card = page.locator('#mgSideBody .sn-mac-card');
  const approva = card.locator('.sn-mac-btn-go');
  await approva.click();
  await expect(approva).toHaveText('Confermi?');
  await approva.click();
  await expect(card.locator('.sn-mac-status')).toHaveText('Chiedo al server di fondere…');
  expect(await approvazioni(page)).toEqual([req.id]);

  await page.locator('#mgSideClose').click();
  await page.locator('.mg-forma[data-livello="l5"]').click();
  await expect(approva).toBeDisabled();
  await expect(card.locator('.sn-mac-status')).toHaveText('Chiedo al server di fondere…');

  // Il segno messo adesso copre la stessa richiesta: aspetta la risposta già in volo.
  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione ferma su questa pratica: Fatto: il lavoro è su main', { timeout: 10000 });
  expect(await approvazioni(page)).toEqual([req.id]);
});

test('una fusione in volo non toglie dal titolo quella che aspetta ancora il sì', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' } });
  const coperta = richiesta();
  // Una seconda richiesta della stessa pratica nata da blocchi nuovi: il segno pieno messo prima non la copre.
  const nuova = richiesta({ id: 'ff12cd34ef56ab12cd34ef99', branch: 'worker/fb-tardiva-1-bis', supersedes: coperta.id });
  await apri(page, [fb], { pending: [coperta, nuova], ritardoMs: 5000 });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([coperta.id]);

  await apriQuadrato(page, fb._id);
  await expect(page.locator('#mgSideBody .sn-mac-title-text')).toHaveText('Una fusione aspetta il tuo via libera');
  const ferma = page.locator(`#mgSideBody .sn-mac-card[data-request-id="${nuova.id}"]`);
  await expect(ferma.locator('.sn-mac-btn-go')).toBeEnabled();
  await expect(page.locator(`#mgSideBody .sn-mac-card[data-request-id="${coperta.id}"] .sn-mac-btn-go`)).toBeDisabled();
});

test('fusione in volo: nessuna frase del pannello o della lista dice ancora che aspetta il tuo sì, nemmeno appena fusa', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ mergePreapproved: { by: 'owner@esempio', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  // Una fusione ferma porta la pratica fra le cose da decidere: la riga in lista sta nei Ricevuti.
  await apri(page, [fb], { pending: [req], ritardoMs: 5000, tab: 'inbox' });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  await apriQuadrato(page, fb._id);

  const lato = page.locator('#mgSideBody');
  await expect(lato.locator('.mg-liv-testo')).toHaveText('Approvata: il server sta fondendo il ramo.');
  await expect(lato.locator('.sn-mac-intro')).toContainText('il server la sta fondendo');
  expect(await lato.innerText()).not.toMatch(/via libera|Aspettano il tuo sì/);
  const riga = page.locator(`.mg-item[data-id="${fb._id}"]`);
  await expect(riga.locator('.mg-fusione-badge')).toHaveText('in fusione');
  expect(await riga.getAttribute('title')).not.toContain('aspetta il tuo via libera');

  // Appena fusa, prima che la pagina rilegga le richieste: niente «in corso» né «aspetta».
  await expect(lato.locator('.sn-mac-status')).toContainText('Fatto: il lavoro è su main', { timeout: 10000 });
  expect(await lato.locator('.sn-mac-title-text').textContent()).toBe('Una fusione decisa');
  expect(await lato.locator('.mg-liv-testo').textContent()).not.toMatch(/via libera|sta fondendo/);
});

test('«Approva e fondi» armato quando la fusione parte da sola: la card passa subito al tentativo in corso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], ritardoMs: 5000 });
  await apriQuadrato(page, fb._id);
  const card = page.locator('#mgSideBody .sn-mac-card');
  const approva = card.locator('.sn-mac-btn-go');
  await approva.click();
  await expect(approva).toHaveText('Confermi?');

  const conSegno = pratica({ _updateTime: 't2', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T10:00:00.000Z' } });
  await page.evaluate((doc) => window.__mgTest.setLiveSources({
    listVersions: async () => [{ _id: doc._id, _updateTime: 't2' }],
    getMany: async () => [doc],
  }), conSegno);
  await page.evaluate(() => window.__mgTest.pollNow());
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);

  await expect(approva).toBeDisabled();
  await expect(approva).toHaveText('Approva e fondi');
  await expect(card.locator('.sn-mac-status')).toContainText('chiedo al server di fondere');
  await expect(page.locator('#mgSideBody .sn-mac-title-text')).toHaveText('Una fusione in corso');
  await expect(page.locator('#mgSideBody .mg-liv-testo')).toHaveText('Approvata: il server sta fondendo il ramo.');
  await expect(card.locator('.sn-mac-status')).toContainText('Fatto: il lavoro è su main', { timeout: 10000 });
  expect(await approvazioni(page)).toEqual([req.id]);
});

test('fusa col tasto, poi il segno (dal tasto o da fuori) prima della rilettura: nessuna seconda approvazione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  const req = richiesta();
  // L'elenco del server la tiene ancora: è la finestra fra la riuscita e la rilettura.
  await apri(page, [fb], { pending: [req], tieniInAttesa: true });
  await apriQuadrato(page, fb._id);
  const card = page.locator('#mgSideBody .sn-mac-card');
  const approva = card.locator('.sn-mac-btn-go');
  await approva.click();
  await approva.click();
  await expect(card.locator('.sn-mac-status')).toContainText('Fatto: il lavoro è su main');

  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgManageMsg')).toHaveText('Da ora si fonde senza chiedere.');
  // Il segno tolto e rimesso da fuori: la pratica segnata e la richiesta ancora in elenco.
  const conSegno = pratica({ _updateTime: 't2', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T10:00:00.000Z' } });
  await page.evaluate((doc) => window.__mgTest.setLiveSources({
    listVersions: async () => [{ _id: doc._id, _updateTime: 't2' }],
    getMany: async () => [doc],
  }), conSegno);
  await page.evaluate(() => window.__mgTest.pollNow());
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(1500);
  expect(await approvazioni(page)).toEqual([req.id]);
  await expect(card.locator('.sn-mac-status')).toContainText('Fatto: il lavoro è su main');
  await expect(approva).toBeDisabled();
});

// ── Il segno rimesso da fuori dopo una fusione non riuscita (#701) ─────────

/** Il documento che torna dal server, come lo porta l'aggiornamento continuo. */
async function daFuori(page, doc) {
  await page.evaluate((d) => window.__mgTest.setLiveSources({
    listVersions: async () => [{ _id: d._id, _updateTime: d._updateTime }],
    getMany: async () => [d],
  }), doc);
  return page.evaluate(() => window.__mgTest.pollNow());
}

const NON_RAGGIUNTO = { ok: false, error: 'github_502 unreachable' };

test('fusione non riuscita: il segno tolto e rimesso dallo script la ritenta, e lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], approveReplies: [NON_RAGGIUNTO] });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  await expect(page.locator('#mgToast')).toContainText('riprova');

  // Lo script toglie il segno e lo rimette: la pagina vede le due letture.
  const senza = pratica({ _updateTime: 't2' });
  expect((await daFuori(page, senza)).changed).toBe(1);
  await page.waitForTimeout(300);
  expect(await approvazioni(page)).toEqual([req.id]);
  expect((await daFuori(page, pratica({ _updateTime: 't3', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T09:05:00.000Z' } }))).changed).toBe(1);

  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id, req.id]);
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione ferma su #581, pratica segnata «fondi senza chiedermelo»: Fatto: il lavoro è su main');
  await expect(page.locator('#mgToast')).toContainText('su main');
});

test('fusione non riuscita: il segno rimesso fra due letture la ritenta lo stesso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], approveReplies: [NON_RAGGIUNTO] });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);

  // Tolto e rimesso prima che la pagina rilegga: resta solo un segno più nuovo.
  await daFuori(page, pratica({ _updateTime: 't3', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T09:05:00.000Z' } }));
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id, req.id]);
  await expect(page.locator('#mgManageMsg')).toContainText('Fatto: il lavoro è su main');
});

test('il segno messo col tasto, riletto dal server, non ritenta da solo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], approveReplies: [NON_RAGGIUNTO] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgManageMsg')).toContainText('riprova');

  // Torna il documento col segno che il main ha scritto, e poi un'altra
  // modifica qualunque: lo stesso segno non è un gesto nuovo.
  const at = await page.evaluate(() => window.__segnoAt);
  await daFuori(page, pratica({ _updateTime: 't2', mergePreapproved: { by: 'owner@esempio', at } }));
  await daFuori(page, pratica({ _updateTime: 't3', starred: true, mergePreapproved: { by: 'owner@esempio', at } }));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.waitForTimeout(1500);
  expect(await approvazioni(page)).toEqual([req.id]);
});

// Una fusione in viaggio non riparte da nessun gesto: né dal segno rimesso
// (col tasto o dallo script) né da «Approva e fondi». Torna il suo esito, uno.
test('fusione in corso: il segno tolto e rimesso col tasto non ne manda una seconda, e lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], ritardoMs: 6000, approveReplies: [NON_RAGGIUNTO] });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);

  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  const btn = page.locator('#mgPreapproveBtn');
  await btn.click();
  await expect(btn).toHaveText('Fondi senza chiedermelo');
  await btn.click();
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione già in corso');
  expect(await approvazioni(page)).toEqual([req.id]);
});

test('fusione partita dal tasto e in corso: il segno rimesso dallo script non ne manda una seconda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], ritardoMs: 6000, approveReplies: [NON_RAGGIUNTO] });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgPreapproveBtn').click();
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);

  await daFuori(page, pratica({ _updateTime: 't2', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T09:05:00.000Z' } }));
  await page.waitForTimeout(1500);
  expect(await approvazioni(page)).toEqual([req.id]);
  // Tornato l'esito, il segno rimesso intanto è una decisione nuova: ritenta, una volta.
  await expect.poll(() => approvazioni(page), { timeout: 15000 }).toEqual([req.id, req.id]);
});

test('fusione partita da sola e in corso: la card lo dice e «Approva e fondi» non ne manda una seconda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T09:00:00.000Z' } });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], ritardoMs: 6000 });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);

  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('.mg-forma[data-livello="l5"]').click();
  await expect(page.locator('#mgSideBody .sn-mac-status')).toContainText('chiedo al server di fondere');
  await expect(page.locator('#mgSideBody .sn-mac-btn-go')).toBeDisabled();
  await expect(page.locator('#mgSideBody .sn-mac-status')).toContainText('su main', { timeout: 10000 });
  expect(await approvazioni(page)).toEqual([req.id]);
});

test('fusione non riuscita: lo script toglie e rimette il segno con lo stesso istante, e la ritenta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const segno = { by: 'owner (script)', at: '2026-09-20T09:00:00.000Z' };
  const req = richiesta();
  await apri(page, [pratica({ _updateTime: 't1', mergePreapproved: segno })], { pending: [req], approveReplies: [NON_RAGGIUNTO] });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  expect((await daFuori(page, pratica({ _updateTime: 't2' }))).changed).toBe(1);
  expect((await daFuori(page, pratica({ _updateTime: 't3', mergePreapproved: segno }))).changed).toBe(1);
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id, req.id]);
  await expect(page.locator('#mgManageMsg')).toContainText('su main');
});

// Tornato l'esito, l'elenco delle fusioni ferme in mano è ancora quello di
// prima: finché non si rilegge, una richiesta già decisa non si rimanda.
test('fusione riuscita mentre il segno veniva rimesso: una rilettura delle pratiche subito dopo non la rimanda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const req = richiesta();
  await apri(page, [pratica({ _updateTime: 't1', mergePreapproved: { by: 'owner (script)', at: '2026-09-20T09:00:00.000Z' } })], { pending: [req], ritardoMs: 3000 });
  await expect.poll(() => approvazioni(page), { timeout: 8000 }).toEqual([req.id]);
  const nuovo = { by: 'owner (script)', at: '2026-09-20T09:05:00.000Z' };
  await daFuori(page, pratica({ _updateTime: 't2', mergePreapproved: nuovo }));
  await expect.poll(() => page.evaluate(() => window.__fuse.length), { timeout: 6000 }).toBe(1);
  await daFuori(page, pratica({ _updateTime: 't3', starred: true, mergePreapproved: nuovo }));
  await page.waitForTimeout(2500);
  expect(await approvazioni(page)).toEqual([req.id]);
  await expect(page.locator('#mgManageMsg')).toContainText('su main');
});

test('«Approva e fondi» riuscito mentre mettevi il segno: una rilettura delle pratiche subito dopo non lo rimanda', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], ritardoMs: 3000 });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('.mg-forma[data-livello="l5"]').click();
  const approva = page.locator('#mgSideBody .sn-mac-btn-go');
  await approva.click();
  await approva.click();
  await expect.poll(() => approvazioni(page), { timeout: 4000 }).toEqual([req.id]);
  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgPreapproveBtn')).toHaveText('Chiedimi prima di fondere');
  await expect.poll(() => page.evaluate(() => window.__fuse.length), { timeout: 6000 }).toBe(1);
  const at = await page.evaluate(() => window.__segnoAt);
  await daFuori(page, pratica({ _updateTime: 't2', starred: true, mergePreapproved: { by: 'owner@esempio', at } }));
  await page.waitForTimeout(2500);
  expect(await approvazioni(page)).toEqual([req.id]);
});

test('«Approva e fondi» in corso, poi il segno col tasto: tornato l’esito, la riga del dettaglio lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica({ _updateTime: 't1' });
  const req = richiesta();
  await apri(page, [fb], { pending: [req], ritardoMs: 4000 });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('.mg-forma[data-livello="l5"]').click();
  const approva = page.locator('#mgSideBody .sn-mac-btn-go');
  await approva.click();
  await approva.click();
  await expect.poll(() => approvazioni(page), { timeout: 4000 }).toEqual([req.id]);
  await page.locator('#mgPreapproveBtn').click();
  await expect(page.locator('#mgManageMsg')).toContainText('Fusione già in corso');
  await expect(page.locator('#mgManageMsg')).toContainText('su main', { timeout: 10000 });
  await expect(page.locator('#mgManageMsg')).not.toContainText('ci sta lavorando');
  expect(await approvazioni(page)).toEqual([req.id]);
});

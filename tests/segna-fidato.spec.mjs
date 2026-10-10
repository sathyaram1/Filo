// «SEGNA FIDATO» IN GESTIONE (#1148), AL POSTO DI «FONDI SENZA CHIEDERMELO» E DI «È MIO».
//
// COSA DEVE ESSERE VERO
//   1. Su un feedback non fidato e aperto il tasto c'è, nel dettaglio e dal tasto destro sulla scheda; il gesto
//      arriva al main come richiesta al server ({ type: 'fiducia_segna', feedbackId }), mai come scrittura del
//      feedback. Riuscito, il tasto sparisce e la riga dice che l'hai segnato tu.
//   2. Se il server non lo segna, il messaggio dice perché e il tasto resta.
//   3. Su un fidato o su una pratica chiusa il tasto non c'è; su un segnalato l'hover dice di guardarlo prima.
//   4. I tasti di prima non ci sono più, e la pagina non fonde da sé le richieste ferme: un vecchio segno nel
//      dato non conta.
//   5. Gestione → Automazioni elenca le fuse senza chiedere: il lavoro fidato come «lavoro fidato: controllo
//      registrato», e le righe di prima come allora, con TUTTO ciò che era stato segnalato.
//
// COME
//   Come merge-approvals.spec.mjs: si stubba il canale verso il main e si ripercorre il codice VERO della pagina.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-preapprova-1',
    name: 'Le regole del database lasciano leggere i segreti',
    text: 'Segnalazione di sicurezza: tocca firestore.rules.',
    seq: 581, subSeq: 0,
    status: 'todo', statusPublic: 'open',
    clientId: 'tester@esempio',
    createdAt: '2026-09-13T08:00:00Z',
    images: [],
  }, over);
}

/** Il canale verso il main: proprietario, e i gesti registrati. */
async function stubMain(page, { preapproved = [], pending = [], fiduciaErr = '' } = {}) {
  await page.evaluate((cfg) => {
    window.__updates = [];
    window.__fiducia = [];
    window.__fusioni = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      if (t === 'fiducia_segna') {
        window.__fiducia.push(msg);
        return cfg.fiduciaErr ? { ok: false, error: cfg.fiduciaErr } : { ok: true, fiducia: 'fidato' };
      }
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: cfg.pending, failed: [], recent: [], preapproved: cfg.preapproved, ttlMs: 7 * 24 * 60 * 60 * 1000 };
      }
      if (t === 'merge_approval_approve') { window.__fusioni.push(msg.id); return { ok: true, result: 'merged', sha: 'deadbeefcafe' }; }
      return orig(msg);
    };
  }, { preapproved, pending, fiduciaErr });
}

async function apri(page, fbs, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, opts);
  await page.evaluate((list) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(list); }, fbs);
  // La pratica di prova sta «In coda» (todo): la lista si guarda lì.
  await page.evaluate((tab) => window.__mgTest.setTab(tab), (opts && opts.tab) || 'queue');
}

test('dal dettaglio: «Segna fidato» va al server, il tasto sparisce e la riga dice che l’hai segnato tu', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb]);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);

  const btn = page.locator('#mgFiduciaBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('🤝 Segna fidato');
  await expect(btn).toHaveAttribute('title', /^L’hai letto e ti fidi: i giudici non servono più/);
  await expect(page.locator('#mgFiduciaInfo')).toBeHidden();
  await btn.click();
  await expect(page.locator('#mgManageMsg')).toContainText('Da ora (#581) è fidato.');
  await expect(btn).toBeHidden();
  await expect(page.locator('#mgFiduciaInfo')).toContainText('Fidato: l’hai segnato tu il ');
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: fb._id }]);
  // La fiducia la scrive il server: la pagina non tocca il feedback.
  expect(await page.evaluate(() => window.__updates)).toEqual([]);
});

test('dal tasto destro sulla scheda fa la stessa cosa del tasto, e apre la pratica', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb]);
  await page.locator(`.mg-item[data-id="${fb._id}"]`).click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Segna fidato' });
  await expect(voce).toHaveAttribute('title', /i giudici non servono più/);
  await voce.click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgManageMsg')).toContainText('è fidato');
  expect(await page.evaluate(() => window.__fiducia)).toEqual([{ type: 'fiducia_segna', feedbackId: fb._id }]);
  // Da fidato la voce non c'è più.
  await page.locator(`.mg-item[data-id="${fb._id}"]`).click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toBeVisible();
  await expect(page.locator('.mg-ctxmenu')).not.toContainText('Segna fidato');
});

test('se il server non lo segna, il messaggio dice perché e il tasto resta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fb = pratica();
  await apri(page, [fb], { fiduciaErr: 'Il feedback non è ancora pubblicato: riprova fra qualche secondo.' });
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgFiduciaBtn').click();
  await expect(page.locator('#mgManageMsg')).toContainText('Non segnato fidato (#581): Il feedback non è ancora pubblicato');
  await expect(page.locator('#mgFiduciaBtn')).toBeVisible();
  await expect(page.locator('#mgFiduciaBtn')).toBeEnabled();
  await expect(page.locator('#mgFiduciaInfo')).toBeHidden();
});

test('su un fidato o su una pratica chiusa il tasto non c’è; su un segnalato l’hover dice di guardarlo prima', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fidato = pratica({ _id: 'fid', seq: 582, fiducia: 'fidato', fiduciaDa: { by: 'migrazione', at: 1 } });
  const chiusa = pratica({ _id: 'chi', seq: 583, status: 'done', statusPublic: 'closed' });
  const segnalato = pratica({ _id: 'seg', seq: 584, status: 'attack' });
  await apri(page, [fidato, chiusa, segnalato]);
  await page.evaluate(() => window.__mgTest.openDetail('fid'));
  await expect(page.locator('#mgFiduciaBtn')).toBeHidden();
  await expect(page.locator('#mgFiduciaInfo')).toHaveText('Fidato: mittente provato o già approvato da te.');
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  await page.evaluate(() => window.__mgTest.openDetail('chi'));
  await expect(page.locator('#mgFiduciaBtn')).toBeHidden();
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await page.evaluate(() => window.__mgTest.openDetail('seg'));
  await expect(page.locator('#mgFiduciaBtn')).toBeVisible();
  await expect(page.locator('#mgFiduciaBtn')).toHaveAttribute('title', /Attenzione: è segnalato come attacco, guardalo prima\.$/);
});

test('i tasti di prima non ci sono, e una richiesta ferma su una pratica col vecchio segno non parte da sola', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const segno = { by: 'owner@esempio', at: '2026-09-13T07:30:00.000Z' };
  const fb = pratica({ mergePreapproved: segno, status: 'design', statusReason: 'l5' });
  const ferma = {
    id: 'cd34ef56ab12cd34ef56ab12', branch: 'worker/581-regole', sha: SHA, who: 'secaudit · notturna',
    origin: 'routine', num: '#581', feedbackId: fb._id, used: false,
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60 * 60 * 1000, expiresAtMs: Date.now() + 6 * 24 * 60 * 60 * 1000,
  };
  await apri(page, [fb], { pending: [ferma], tab: 'inbox' });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgDetail')).toBeVisible();
  for (const via of ['#mgPreapproveBtn', '#mgPreapproveRevokeBtn', '#mgPreapprovedInfo', '#mgSenderBtn']) {
    await expect(page.locator(via)).toHaveCount(0);
  }
  await expect(page.locator('.mg-preapproved')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__fusioni)).toEqual([]);
});

test('Automazioni: il lavoro fidato si legge come «lavoro fidato: controllo registrato», e la pratica è a un clic', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fusa = {
    id: 'ef56ab12cd34ef56ab12cd34', branch: 'claude/fiducia', sha: SHA, mergeSha: 'feedface'.repeat(5),
    who: 'owner@esempio', origin: 'locale', num: '#581', feedbackId: 'fb-preapprova-1',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60 * 60 * 1000, decidedAtMs: Date.now() - 60 * 60 * 1000,
    used: true, outcome: 'merged', skippedL5: true, motivo: 'fiducia', preapprovedBy: 'fiducia',
  };
  await apri(page, [pratica({ fiducia: 'fidato' })], { preapproved: [fusa] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible({ timeout: 8_000 });
  await expect(box).toContainText('lavoro fidato: controllo registrato');
  await expect(box.locator('.sn-mac-preapproved-intro')).toContainText('Erano lavoro fidato');
  await expect(box).not.toContainText(/pre-approvata|fondi senza chiedermelo/);
  await expect(box).toContainText('firestore.rules');
  await box.locator('.sn-mac-origin-link').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('Automazioni: le righe di prima restano leggibili, con tutto quello che era stato segnalato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const file = Array.from({ length: 30 }, (_, i) => `scripts/lib/guardia-${i}.mjs`);
  const fusa = {
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'worker/581-regole',
    sha: SHA,
    mergeSha: 'feedfacefeedface'.repeat(2) + 'feedface',
    who: 'secaudit · notturna',
    origin: 'routine',
    num: '#581',
    feedbackId: 'fb-preapprova-1',
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: file, more: 0 },
      { gate: 'secret_detected', label: 'Nelle modifiche c’è qualcosa che sembra un segreto', items: ['tests/agent/.env: FILO_TOKEN=…'], more: 0 },
    ],
    createdAtMs: Date.now() - 3 * 60 * 60 * 1000,
    decidedAtMs: Date.now() - 3 * 60 * 60 * 1000,
    used: true, outcome: 'merged',
    preapproved: true, preapprovedBy: 'owner@esempio', preapprovedAt: '2026-09-13T07:30:00.000Z',
  };
  await apri(page, [pratica()], { preapproved: [fusa] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();

  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible({ timeout: 8_000 });
  await expect(box).toContainText('Fuse senza chiedere');
  await expect(box).toContainText('worker/581-regole');
  await expect(box).toContainText('feedface');
  await expect(box).toContainText('pre-approvata da owner@esempio');
  await expect(box).toContainText('automazione · feedback #581');
  await expect(box).toContainText('Tocca aree protette');
  await expect(box).toContainText('sembra un segreto');
  // L'elenco intero: trenta file, tutti, uno per riga.
  await expect(box.locator('.sn-mac-block-items')).toHaveCount(31);
  await expect(box).toContainText('scripts/lib/guardia-29.mjs');
  await expect(box).not.toContainText('e altri');
  // Il feedback è a un click.
  await page.locator('#mgMergeApprovalsPreapproved .sn-mac-origin-link').click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgDetail')).toContainText('tester@e');
  await expect(page.locator('#mgFiduciaBtn')).toBeVisible();
});

// Il controllo a posteriori si legge a distanza di giorni, e può essere lungo:
// la riga dice la DATA della fusione (non solo «N giorni fa»), e se il server
// ha lasciato fuori le più vecchie lo dice, invece di tacere.
test('Automazioni: la data della fusione per esteso, e quante ne restano fuori', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const fusaAt = Date.now() - 9 * 24 * 60 * 60 * 1000;
  const d = new Date(fusaAt);
  const p = (n) => String(n).padStart(2, '0');
  const data = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} alle ${p(d.getHours())}:${p(d.getMinutes())}`;
  const righe = Array.from({ length: 8 }, (_, i) => ({
    id: String(i).padStart(24, 'a'), branch: `worker/lavoro-${i}`, sha: SHA, mergeSha: SHA,
    who: 'secaudit · notturna', origin: 'routine', num: `#${600 + i}`, feedbackId: `f${i}`,
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: fusaAt - i * 1000, expiresAtMs: fusaAt + 7 * 24 * 60 * 60 * 1000, expired: true,
    used: true, discarded: false, outcome: 'merged', decidedAtMs: fusaAt - i * 1000,
    preapproved: true, preapprovedBy: 'owner@esempio', preapprovedAt: '2026-09-13T08:00:00.000Z',
  }));
  await apri(page, [pratica()], { preapproved: righe });
  // Il server ne ha tre in più, più vecchie, oltre il suo tetto.
  await page.evaluate(() => {
    const orig = window.filo.message;
    window.filo.message = async (msg) => {
      const r = await orig(msg);
      if (msg && msg.type === 'merge_approvals_get' && r && r.ok) r.preapprovedTotal = 11;
      return r;
    };
  });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible();
  await expect(box.locator('.sn-mac-preapproved-row')).toHaveCount(8);
  await expect(box.locator('.sn-mac-recent-when').first()).toHaveText(`fusa il ${data} (9 giorni fa)`);
  await expect(box.locator('.sn-mac-preapproved-more')).toHaveText('Ce ne sono altre 3, più vecchie, che qui non entrano.');
});

test('senza fusioni pre-approvate l’elenco non compare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()], { preapproved: [] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#mgMergeApprovalsPreapproved')).toBeHidden();
});

// #743: la fusione nata dal segno di un sì non si presenta come «fondi senza chiedermelo».
test('Automazioni: una fusa col segno di un sì non dice «fondi senza chiedermelo»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const AT = '2026-09-26T10:26:00.000Z';
  const riga = (i, over) => Object.assign({
    id: String(i).padStart(24, 'b'), branch: `worker/lavoro-${i}`, sha: SHA, mergeSha: SHA,
    who: 'secaudit · notturna', origin: 'routine', num: `#${700 + i}`, feedbackId: `f${i}`,
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60 * 60 * 1000, used: true, outcome: 'merged', decidedAtMs: Date.now() - 60 * 60 * 1000,
    preapproved: true, preapprovedAt: AT,
  }, over);
  const daSi = riga(1, { preapprovedBy: 'owner@esempio · approvazione ab12cd34ef56ab12cd34ef56' });
  await apri(page, [pratica()], { preapproved: [daSi] });
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const box = page.locator('#mgMergeApprovalsPreapproved');
  await expect(box).toBeVisible({ timeout: 8_000 });
  const intro = box.locator('.sn-mac-preapproved-intro');
  await expect(intro).toContainText('Avevano solo blocchi che avevi già approvato, con un sì a una richiesta precedente');
  await expect(intro).not.toContainText('fondi senza chiedermelo');
  const who = box.locator('.sn-mac-recent-who');
  await expect(who).toContainText('pre-approvata dal tuo sì alla richiesta del');
  await expect(who).toHaveAttribute('title', /valeva solo per i blocchi già approvati/);
  await page.screenshot({ path: 'tests/.shots/segna-fidato-743-da-si.png' });

  // Con una fusa a mano accanto, l'introduzione dice le due cose e a chi vanno.
  const aMano = riga(2, { preapprovedBy: 'owner@esempio' });
  await page.evaluate((list) => {
    const orig = window.filo.message;
    window.filo.message = async (msg) => {
      const r = await orig(msg);
      if (msg && msg.type === 'merge_approvals_get' && r && r.ok) r.preapproved = list;
      return r;
    };
  }, [aMano, daSi]);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(box.locator('.sn-mac-preapproved-row')).toHaveCount(2);
  await expect(intro).toContainText('Alcuni avevano sulla pratica il tuo «fondi senza chiedermelo»; altri avevano solo blocchi che avevi già approvato');
  await expect(who.first()).toContainText('pre-approvata da owner@esempio');
  await expect(who.first()).toHaveAttribute('title', /^Segno messo il /);
  await page.screenshot({ path: 'tests/.shots/segna-fidato-743-misto.png' });
});

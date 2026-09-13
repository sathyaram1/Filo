// Giro 1 (verifica locale, ramo claude/esiti-riallineamento).
//
// Cosa deve leggere l'owner in Gestione quando il server ha riallineato un
// ramo approvato (o ha provato e non c'è riuscito): la scheda in attesa nata
// dal riallineamento, le righe di «Decise di recente», la scheda «approvata ma
// non avvenuta» col motivo in italiano, e l'esito sotto «Approva e fondi».
// Sui due temi.
//
// Il canale verso il main è sostituito DALLA PAGINA (come nello spec della
// feature): qui si prova il disegno e le frasi, dato ciò che il main passa.
// Che il main passi davvero quei campi lo prova l'altra spec di questo giro.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SHA_A = 'a1b2c3d4'.repeat(5);
const SHA_B = 'b2c3d4e5'.repeat(5);
const SHA_M = 'c3d4e5f6'.repeat(5);
const GIORNO = 24 * 60 * 60 * 1000;

function richiesta(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'claude/lavoro-riallineato',
    sha: SHA_A,
    who: 'worker/routine',
    origin: 'routine',
    num: '600',
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['firestore.rules'], more: 0 },
    ],
    createdAtMs: Date.now() - 2 * 60 * 1000,
    expiresAtMs: Date.now() + GIORNO,
    expired: false, used: false, discarded: false,
  }, over);
}

async function stub(page, cfg) {
  await page.evaluate((cfg) => {
    window.__macCalls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') {
        const dopo = window.__macCalls.some((c) => c.op === 'approve');
        return { ok: true, pending: dopo && cfg.pendingDopo ? cfg.pendingDopo : (cfg.pending || []), failed: cfg.failed || [], recent: cfg.recent || [], ttlMs: 7 * cfg.GIORNO };
      }
      if (t === 'merge_approval_approve') { window.__macCalls.push({ op: 'approve', id: msg.id }); return cfg.approveReply; }
      if (t === 'merge_approval_discard') { window.__macCalls.push({ op: 'discard', id: msg.id }); return { ok: true, result: 'discarded' }; }
      return orig(msg);
    };
  }, Object.assign({ GIORNO }, cfg));
}

async function apri(page, cfg) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stub(page, cfg);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

async function tema(page, quale) {
  await page.emulateMedia({ colorScheme: quale });
  await page.evaluate((q) => document.documentElement.setAttribute('data-theme', q), quale);
}

async function approvaDavvero(page) {
  const btn = page.locator('.sn-mac-card:not(.sn-mac-card-failed) .sn-mac-btn-go').first();
  await btn.click();
  await expect(btn).toHaveText('Confermi?');
  await btn.click();
}

test('la scheda nata dal riallineamento dice da dove viene e che sotto c’è solo il nuovo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [richiesta({ id: 'ff00ff00ff00ff00ff00ff00', sha: SHA_B, supersedes: 'ab12cd34ef56ab12cd34ef56', realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M } })],
  });
  const card = page.locator('.sn-mac-card').first();
  await expect(card).toBeVisible();
  const nota = card.locator('.sn-mac-realigned');
  await expect(nota).toHaveText('Punta riallineata su main dal server (era a1b2c3d4): qui solo ciò che non avevi ancora visto.');
  await expect(card.locator('.sn-mac-why')).toHaveText('Bloccata perché (solo il nuovo):');
  await expect(card.locator('.sn-mac-sha')).toHaveText('b2c3d4e5');

  // Sui due temi la riga si legge (non è invisibile né uguale al fondo).
  for (const t of ['light', 'dark']) {
    await tema(page, t);
    const col = await nota.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fg: cs.color, bg: getComputedStyle(el.closest('.sn-mac-card')).backgroundColor, op: cs.opacity, vis: cs.visibility };
    });
    expect(col.fg).not.toBe(col.bg);
    expect(col.vis).toBe('visible');
    await card.screenshot({ path: 'tests/.shots/verifica-esiti-riallineamento-scheda-' + t + '.png' });
  }
});

test('senza lo sha di partenza la riga c’è lo stesso; senza supersedes non c’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [
      richiesta({ id: 'ff00ff00ff00ff00ff00ff01', supersedes: 'ab12cd34ef56ab12cd34ef56' }),
      richiesta({ id: 'ff00ff00ff00ff00ff00ff02', branch: 'claude/normale' }),
    ],
  });
  const cards = page.locator('.sn-mac-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('.sn-mac-realigned')).toHaveText('Punta riallineata su main dal server: qui solo ciò che non avevi ancora visto.');
  await expect(cards.nth(1).locator('.sn-mac-realigned')).toHaveCount(0);
  await expect(cards.nth(1).locator('.sn-mac-why')).toHaveText('Bloccata perché:');
});

test('Decise di recente: stale riallineata, merged riallineata, stale decaduta, mai «approvata» per una stale', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const ora = Date.now() - 60 * 1000;
  await apri(page, {
    recent: [
      richiesta({ id: 'r1', branch: 'claude/r1', used: true, outcome: 'stale', realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M }, newRequestId: 'x', decidedAtMs: ora }),
      richiesta({ id: 'r2', branch: 'claude/r2', used: true, outcome: 'merged', mergeSha: SHA_M, realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M }, decidedAtMs: ora }),
      richiesta({ id: 'r3', branch: 'claude/r3', used: true, outcome: 'stale', decidedAtMs: ora }),
      richiesta({ id: 'r4', branch: 'claude/r4', used: true, outcome: 'merged', mergeSha: SHA_M, decidedAtMs: ora }),
      richiesta({ id: 'r5', branch: 'claude/r5', used: true, outcome: 'conflict', realignReason: 'riallineamento automatico non riuscito: realign_branch_moved', decidedAtMs: ora }),
    ],
  });
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const righe = page.locator('.sn-mac-recent-row');
  await expect(righe).toHaveCount(5);
  const esiti = await righe.locator('.sn-mac-recent-what').allTextContents();
  expect(esiti).toEqual([
    'riallineata, chiede di nuovo',
    'approvata, riallineata e fusa',
    'decaduta',
    'approvata e fusa',
    'approvata, ma in conflitto',
  ]);
  for (const e of esiti.slice(0, 3)) expect(e).not.toBe('approvata');
});

test('la scheda «approvata ma non avvenuta» dice che il server ha provato, col motivo in italiano; un motivo sconosciuto resta com’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, {
    failed: [
      richiesta({ id: 'f1', branch: 'claude/f1', used: true, outcome: 'conflict', decidedAtMs: Date.now() - 3 * 60 * 1000,
        realignReason: 'richiesta nuova per la punta riallineata non registrata: realign_request_failed' }),
      richiesta({ id: 'f2', branch: 'claude/f2', used: true, outcome: 'conflict', decidedAtMs: Date.now() - 3 * 60 * 1000,
        realignReason: 'riallineamento automatico non riuscito: motivo_mai_visto_prima (<b>x</b>)' }),
      richiesta({ id: 'f3', branch: 'claude/f3', used: true, outcome: 'conflict', decidedAtMs: Date.now() - 3 * 60 * 1000 }),
    ],
  });
  const schede = page.locator('.sn-mac-card-failed');
  await expect(schede).toHaveCount(3);
  const t1 = await schede.nth(0).locator('.sn-mac-why').textContent();
  expect(t1).toContain('Il server ha provato a riallineare da sé, senza riuscirci: richiesta nuova per la punta riallineata non registrata: la richiesta nuova per la punta riallineata non si è registrata.');
  const t2 = await schede.nth(1).locator('.sn-mac-why').textContent();
  expect(t2).toContain('Il server ha provato a riallineare da sé, senza riuscirci: motivo_mai_visto_prima (<b>x</b>).');
  expect(await schede.nth(1).locator('.sn-mac-why b').count()).toBe(0); // testo, non HTML
  const t3 = await schede.nth(2).locator('.sn-mac-why').textContent();
  expect(t3).not.toContain('ha provato a riallineare');
});

test('Approva → stale riallineata: la frase dice che c’è una richiesta nuova, e la scheda nuova compare da sola', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [richiesta()],
    pendingDopo: [richiesta({ id: 'ff00ff00ff00ff00ff00ff00', sha: SHA_B, supersedes: 'ab12cd34ef56ab12cd34ef56', realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M } })],
    approveReply: { ok: true, result: 'stale', headSha: SHA_B, realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M }, newRequest: 'ff00ff00ff00ff00ff00ff00', newBlocks: [] },
  });
  await approvaDavvero(page);
  const status = page.locator('.sn-mac-status').first();
  await expect(status).toBeVisible();
  const testo = await status.textContent();
  expect(testo).toContain('il server ha riallineato il ramo');
  expect(testo).toContain('richiesta nuova con solo quella differenza');
  expect(testo).not.toMatch(/decade|Rilancia|npm run finish/);
  // L'elenco si ricarica: la scheda nuova (con la riga del riallineamento) arriva senza riaprire la pagina.
  await expect(page.locator('.sn-mac-card .sn-mac-realigned')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.sn-mac-card[data-request-id="ff00ff00ff00ff00ff00ff00"]')).toHaveCount(1);
});

test('Approva → merged riallineata: la frase dice che main era avanti e che il server ha riallineato, rifatto i controlli e fuso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [richiesta()],
    approveReply: { ok: true, result: 'merged', sha: SHA_M, realigned: { from: SHA_A, to: SHA_B, mainSha: SHA_M } },
  });
  await approvaDavvero(page);
  const status = page.locator('.sn-mac-status').first();
  await expect(status).toHaveText('Fatto: main era andato avanti, il server ha riallineato il ramo, rifatto i controlli e fuso (c3d4e5f6).');
});

test('Approva → conflict con tentativo fallito: la frase aggiunge il tentativo del server col motivo tradotto', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, {
    pending: [richiesta()],
    approveReply: { ok: true, result: 'conflict', reason: 'conflitto di merge: serve risoluzione manuale', realignReason: 'riallineamento automatico non riuscito: realign_branch_moved' },
  });
  await approvaDavvero(page);
  const status = page.locator('.sn-mac-status').first();
  await expect(status).toBeVisible();
  const testo = await status.textContent();
  expect(testo).toContain('Main è andato avanti');
  expect(testo).toContain('Il server ha provato a riallineare da sé, senza riuscirci: il ramo si era mosso dopo l’approvazione');
  expect(testo).not.toContain('realign_branch_moved');
});

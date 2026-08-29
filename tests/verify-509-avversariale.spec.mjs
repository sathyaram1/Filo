// #509 — verifica avversariale (giro 2).
//
// Il sintomo del ticket: le due pagine che elencano le segnalazioni chiamano le
// sezioni con gli stessi nomi ma le riempiono con regole diverse, e i numeri
// accanto ai nomi lo rendono visibile ("Ricevuti (3)" di là, "Ricevuti (9)" di
// qua). Il giro precedente ha bocciato per una porta diversa: cliccando due
// volte nello stesso punto della pagina dei feedback il secondo clic agiva su
// una segnalazione diversa. Qui si ri-provano TUTTE le porte già trovate e se
// ne cercano di nuove.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const VERSIONE = '1.0.0';

// Admin simulato + canale main intercettato: nessuna rete, scritture catturate.
async function apriFeedback(openTab, items, { ritardo = 0, esito = { ok: true } } = {}) {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(({ ritardo, esito }) => {
    window.__updates = [];
    window.__ritardo = ritardo;
    window.__esito = esito;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        if (window.__ritardo) await new Promise((r) => setTimeout(r, window.__ritardo));
        return window.__esito;
      }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false };
      return orig(msg);
    };
  }, { ritardo, esito });
  await page.evaluate(() => window.__fbTest.setAdmin(true, { email: 'owner@example.com' }));
  await page.evaluate((v) => window.__fbTest.setReleasedVersion(v), VERSIONE);
  await page.evaluate((items) => window.__fbTest.setData(items), items);
  return page;
}

const updates = (page) => page.evaluate(() => window.__updates.slice());

// Clic col MOUSE su un punto fisso dello schermo: è la manovra del giro
// precedente (il puntatore non si sposta fra un clic e l'altro).
async function puntoDi(page, selettore) {
  const box = await page.locator(selettore).first().boundingBox();
  if (!box) throw new Error(`nessun riquadro per ${selettore}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// ─────────────────────────────────────────────────────────────────────────────
// PORTA 1 — Ricevuti: due volte «→ In coda» nello stesso punto.
// Nel giro precedente il secondo clic marcava la segnalazione successiva come
// ATTACCO CONFERMATO.
// ─────────────────────────────────────────────────────────────────────────────
test('#509 — due clic fermi su «→ In coda» non toccano la segnalazione successiva', async ({ openTab }) => {
  const coda = [
    { _id: 'c1', seq: 1, status: 'unlabeled', name: 'prima', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'c2', seq: 2, status: 'attack', name: 'seconda', text: 'due', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'c3', seq: 3, status: 'spam', name: 'terza', text: 'tre', createdAt: '2026-08-03T10:00:00Z' },
    { _id: 'c4', seq: 4, status: 'suspicious_file', name: 'quarta', text: 'quattro', createdAt: '2026-08-04T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (4)');

  const p = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="todo"]');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  // e una terza, per sicurezza
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);

  const u = await updates(page);
  expect(u.map((x) => `${x.id}:${x.status}`)).toEqual(['c1:todo']);
});

test('#509 — doppio clic velocissimo (dblclick) su «→ In coda»: una sola scrittura', async ({ openTab }) => {
  const coda = [
    { _id: 'c1', seq: 1, status: 'unlabeled', name: 'prima', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'c2', seq: 2, status: 'attack', name: 'seconda', text: 'due', createdAt: '2026-08-02T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda, { ritardo: 500 });
  const p = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="todo"]');
  await page.mouse.dblclick(p.x, p.y);
  await page.waitForTimeout(1200);
  const u = await updates(page);
  expect(u.map((x) => `${x.id}:${x.status}`)).toEqual(['c1:todo']);
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTA 2 — In coda: due volte «✓ Risolto».
// ─────────────────────────────────────────────────────────────────────────────
test('#509 — due clic fermi su «✓ Risolto» chiudono una sola segnalazione', async ({ openTab }) => {
  const coda = [
    { _id: 'q1', seq: 11, status: 'todo', name: 'prima coda', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'q2', seq: 12, status: 'working', name: 'seconda coda', text: 'due', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'q3', seq: 13, status: 'revision_capability', name: 'terza coda', text: 'tre', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  await page.locator('#tabs [data-tab="queue"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(3);

  const p = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="done"]');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);

  const u = await updates(page);
  expect(u.filter((x) => x.status === 'done').length).toBe(1);
  expect(u.length).toBe(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTA 3 — Archiviati: due volte «↩ Ripristina».
// ─────────────────────────────────────────────────────────────────────────────
test('#509 — due clic fermi su «↩ Ripristina» ne rimettono in coda una sola', async ({ openTab }) => {
  const coda = [
    { _id: 'a1', seq: 21, status: 'archived', name: 'primo arch', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'a2', seq: 22, status: 'archived', name: 'secondo arch', text: 'due', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'a3', seq: 23, status: 'attack_confirmed', name: 'terzo arch', text: 'tre', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  await page.locator('#tabs [data-tab="archived"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(3);

  const p = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="todo"]');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);

  const u = await updates(page);
  expect(u.length).toBe(1);
  expect(u[0].id).toBe('a1');
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTA 4 — due pulsanti DIVERSI della stessa scheda, mentre la prima
// scrittura è ancora in volo: «Archivia» non deve sovrascrivere «→ In coda».
// ─────────────────────────────────────────────────────────────────────────────
test('#509 — «Archivia» premuto mentre «→ In coda» è in volo non scrive una seconda decisione', async ({ openTab }) => {
  const coda = [
    { _id: 'c1', seq: 1, status: 'unlabeled', name: 'prima', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'c2', seq: 2, status: 'unlabeled', name: 'seconda', text: 'due', createdAt: '2026-08-02T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda, { ritardo: 900 });
  const pTodo = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="todo"]');
  const pArch = await puntoDi(page, '.fb-card:first-child .fb-act[data-to="archived"]');
  await page.mouse.click(pTodo.x, pTodo.y);
  await page.waitForTimeout(150);
  await page.mouse.click(pArch.x, pArch.y);
  await page.waitForTimeout(1500);
  const u = await updates(page);
  expect(u.map((x) => `${x.id}:${x.status}`)).toEqual(['c1:todo']);
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTA 5 — pallini della priorità in «In coda» (la priorità è un criterio di
// ordinamento: ridisegnare la lista sposterebbe la scheda sotto il dito).
// ─────────────────────────────────────────────────────────────────────────────
test('#509 — due clic fermi su un pallino di priorità non toccano la scheda vicina', async ({ openTab }) => {
  const coda = [
    { _id: 'q1', seq: 11, status: 'todo', name: 'prima coda', text: 'uno', priority: 0, createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'q2', seq: 12, status: 'todo', name: 'seconda coda', text: 'due', priority: 0, createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'q3', seq: 13, status: 'todo', name: 'terza coda', text: 'tre', priority: 0, createdAt: '2026-08-03T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  await page.locator('#tabs [data-tab="queue"]').click();
  await expect(page.locator('.fb-card')).toHaveCount(3);
  const p = await puntoDi(page, '.fb-card:first-child .fb-dot[data-n="3"]');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(400);
  const u = await updates(page);
  // Due clic voluti sullo stesso pallino = imposta 3, poi azzera. Purché
  // riguardino SEMPRE la stessa scheda.
  expect(new Set(u.map((x) => x.id))).toEqual(new Set(['q1']));
});

// ─────────────────────────────────────────────────────────────────────────────
// Il clic si VEDE: senza conferma a schermo il secondo clic viene naturale.
// ─────────────────────────────────────────────────────────────────────────────
test('#509 — il clic dà conferma: pulsanti spenti durante la scrittura, esito dopo', async ({ openTab }) => {
  const coda = [
    { _id: 'c1', seq: 1, status: 'unlabeled', name: 'prima', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda, { ritardo: 900 });
  const card = page.locator('.fb-card').first();
  await card.locator('.fb-act[data-to="todo"]').click({ noWaitAfter: true });
  await expect(card).toHaveClass(/fb-card--busy/);
  await expect(card.locator('.fb-act[data-to="archived"]')).toBeDisabled();
  await expect(card.locator('.fb-esito')).toBeVisible({ timeout: 5000 });
  await expect(card.locator('.fb-esito')).toContainText('In coda');
});

// ─────────────────────────────────────────────────────────────────────────────
// PARITÀ DELLE SEZIONI su una coda STORTA: stati legacy, stato inventato,
// stato mancante, fix chiuso ma non ancora uscito.
// ─────────────────────────────────────────────────────────────────────────────
const CODA_STORTA = [
  { _id: 's1', seq: 1, status: 'new', name: 'legacy new', text: 'a', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 's2', seq: 2, status: 'draft', name: 'legacy draft', text: 'b', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 's3', seq: 3, status: 'review', name: 'legacy review', text: 'c', createdAt: '2026-08-03T10:00:00Z' },
  { _id: 's4', seq: 4, status: 'clarify', name: 'legacy clarify', text: 'd', createdAt: '2026-08-04T10:00:00Z' },
  { _id: 's5', seq: 5, status: 'verified', name: 'legacy verified', text: 'e', createdAt: '2026-08-05T10:00:00Z' },
  { _id: 's6', seq: 6, status: 'ignored', name: 'legacy ignored', text: 'f', createdAt: '2026-08-06T10:00:00Z' },
  { _id: 's7', seq: 7, status: 'blocked', blockReason: 'loop', name: 'legacy blocked', text: 'g', createdAt: '2026-08-07T10:00:00Z' },
  { _id: 's8', seq: 8, status: 'pinco-pallino', name: 'stato inventato', text: 'h', createdAt: '2026-08-08T10:00:00Z' },
  { _id: 's9', seq: 9, name: 'stato mancante', text: 'i', createdAt: '2026-08-09T10:00:00Z' },
  { _id: 's10', seq: 10, status: '', name: 'stato vuoto', text: 'j', createdAt: '2026-08-10T10:00:00Z' },
  { _id: 's11', seq: 11, status: 'done', resolvedInVersion: '9.9.9', name: 'chiuso non uscito', text: 'k', createdAt: '2026-08-11T10:00:00Z' },
  { _id: 's12', seq: 12, status: 'done', resolvedInVersion: '0.9.0', name: 'chiuso uscito', text: 'l', createdAt: '2026-08-12T10:00:00Z' },
  { _id: 's13', seq: 13, status: 'spam_confirmed', name: 'spam confermato', text: 'm', createdAt: '2026-08-13T10:00:00Z' },
  { _id: 's14', seq: 14, status: 'suspicious_file', name: 'file sospetto', text: 'n', createdAt: '2026-08-14T10:00:00Z' },
];

async function etichetteFeedback(page) {
  const out = {};
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    const el = page.locator(`#tabs [data-tab="${tab}"]`);
    out[tab] = (await el.innerText()).trim().replace(/\s+/g, ' ');
  }
  return out;
}

async function etichetteManage(page) {
  const out = {};
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    const el = page.locator(`.mg-tab[data-tab="${tab}"]`);
    out[tab] = (await el.innerText()).trim().replace(/\s+/g, ' ');
  }
  return out;
}

async function apriManage(openTab, items) {
  const mg = await openTab(MANAGE);
  await mg.waitForLoadState('domcontentloaded');
  await mg.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await mg.evaluate(() => window.__mgTest.whenReady());
  await mg.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);
  await mg.evaluate((its) => window.__mgTest.setData(its), items);
  return mg;
}

test('#509 — coda storta: stessi nomi, stessi numeri, stessi contenuti nelle due pagine', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA_STORTA);
  const eFb = await etichetteFeedback(fb);

  // Contenuto di ogni sezione sulla pagina dei feedback.
  const contenutoFb = {};
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    await fb.locator(`#tabs [data-tab="${tab}"]`).click();
    contenutoFb[tab] = (await fb.locator('.fb-card').evaluateAll(
      (els) => els.map((e) => e.dataset.id),
    )).sort();
  }

  const mg = await apriManage(openTab, CODA_STORTA);
  const eMg = await etichetteManage(mg);
  expect(eMg, 'nomi e numeri delle sezioni').toEqual(eFb);

  // E gli stessi elementi dentro, non solo lo stesso conteggio: il contenuto
  // atteso lo calcolano le funzioni pure della gemella.
  const contenutoAtteso = await mg.evaluate(({ items, v }) => {
    const MR = window.SN_MANAGE_REVIEW;
    const out = {};
    for (const t of ['inbox', 'queue', 'resolved']) {
      out[t] = MR.listForManageTab(items, t, { releasedVersion: v }).map((f) => f._id).sort();
    }
    out.archived = MR.listArchiveTab(items, { releasedVersion: v }).map((f) => f._id).sort();
    return out;
  }, { items: CODA_STORTA, v: VERSIONE });
  expect(contenutoFb, 'contenuto delle sezioni').toEqual(contenutoAtteso);
});

// ─────────────────────────────────────────────────────────────────────────────
// Stato ILLEGGIBILE (chi apre la pagina senza la chiave dell'owner).
// ─────────────────────────────────────────────────────────────────────────────
const CODA_CIFRATA = [
  { _id: 'x1', seq: 1, status: 'FENC1:aaaaaaaaaaaaaaaaaaaa', statusPublic: 'open', name: 'una', text: 'a', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'x2', seq: 2, status: 'FENC1:bbbbbbbbbbbbbbbbbbbb', statusPublic: 'closed', name: 'due', text: 'b', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'x3', seq: 3, status: 'FENC1:cccccccccccccccccccc', statusPublic: 'closed', name: 'tre', text: 'c', createdAt: '2026-08-03T10:00:00Z' },
];

test('#509 — stato illeggibile: le due pagine devono dire la stessa cosa', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA_CIFRATA);
  const tabsVisibiliFb = await fb.locator('#tabs').isVisible();
  const testoFb = tabsVisibiliFb ? await etichetteFeedback(fb) : null;

  const mg = await apriManage(openTab, CODA_CIFRATA);
  const tabsVisibiliMg = await mg.locator('.mg-tabs, #mgTabs').first().isVisible().catch(() => true);
  const testoMg = await etichetteManage(mg);

  // Diagnostica leggibile nel report anche quando passa.
  test.info().annotations.push({
    type: 'cifrato',
    description: `feedback: sezioni ${tabsVisibiliFb ? JSON.stringify(testoFb) : 'NASCOSTE'} — manage: sezioni ${tabsVisibiliMg ? JSON.stringify(testoMg) : 'NASCOSTE'}`,
  });

  expect(
    { tabs: tabsVisibiliFb, testo: testoFb },
    'le due pagine davanti a uno stato che non si legge',
  ).toEqual({ tabs: tabsVisibiliMg, testo: tabsVisibiliMg ? testoMg : null });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stress: testo lunghissimo, emoji, HTML, javascript: URL, null byte.
// ─────────────────────────────────────────────────────────────────────────────
test('#509 — input limite: niente XSS, niente sezioni sbagliate', async ({ openTab }) => {
  const lungo = 'A'.repeat(10000);
  const coda = [
    { _id: 'z1', seq: 1, status: 'unlabeled', name: '<img src=x onerror="window.__xss=1">', text: '<script>window.__xss=2</script>', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'z2', seq: 2, status: 'todo', name: '🚀🎉 emoji', text: lungo, url: 'javascript:window.__xss=3', createdAt: '2026-08-02T10:00:00Z' },
    { _id: 'z3', seq: 3, status: 'archived', name: 'null byte', text: '   ', notes: '"><svg onload="window.__xss=4">', createdAt: '2026-08-03T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda);
  await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (1)');
  await expect(page.locator('#tabs [data-tab="queue"]')).toHaveText('In coda (1)');
  await expect(page.locator('#tabs [data-tab="archived"]')).toHaveText('Archiviati (1)');
  for (const tab of ['inbox', 'queue', 'archived']) {
    await page.locator(`#tabs [data-tab="${tab}"]`).click();
    await expect(page.locator('.fb-card')).toHaveCount(1);
  }
  expect(await page.evaluate(() => window.__xss || null)).toBe(null);
  // Nessun link con schema pericoloso.
  const href = await page.evaluate(() => Array.from(document.querySelectorAll('#list a')).map((a) => a.getAttribute('href')));
  expect(href.filter((h) => /^javascript:/i.test(h || '')).length).toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Coda vuota e scrittura RIFIUTATA dal server.
// ─────────────────────────────────────────────────────────────────────────────
test('#509 — coda vuota: nomi senza numeri inventati', async ({ openTab }) => {
  const page = await apriFeedback(openTab, []);
  await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (0)');
  await expect(page.locator('#tabs')).toBeVisible();
});

test('#509 — scrittura rifiutata: la scheda torna premibile e il numero non mente', async ({ openTab }) => {
  const coda = [
    { _id: 'c1', seq: 1, status: 'unlabeled', name: 'prima', text: 'uno', createdAt: '2026-08-01T10:00:00Z' },
    { _id: 'c2', seq: 2, status: 'unlabeled', name: 'seconda', text: 'due', createdAt: '2026-08-02T10:00:00Z' },
  ];
  const page = await apriFeedback(openTab, coda, { esito: { ok: false, error: 'no' } });
  page.on('dialog', (d) => d.accept());
  const card = page.locator('.fb-card').first();
  await card.locator('.fb-act[data-to="todo"]').click({ noWaitAfter: true });
  await expect(card.locator('.fb-act[data-to="todo"]')).toBeEnabled({ timeout: 8000 });
  await expect(page.locator('#tabs [data-tab="inbox"]')).toHaveText('Ricevuti (2)');
  await expect(page.locator('#tabs [data-tab="queue"]')).toHaveText('In coda (0)');
});

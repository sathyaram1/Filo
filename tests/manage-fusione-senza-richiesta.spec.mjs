// Una pratica ferma al cancello senza richiesta di fusione (#1556): il quadrato dice il perché (la nota del server, o
// che nessuna richiesta è aperta) e offre «Rimanda in lavorazione» e «Archivia», le stesse azioni della riga
// dell'owner. In lista niente «via libera» promesso; con una richiesta aperta il quadrato resta Approva/Scarta.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const NOTA = 'Il cancello non fonde il ramo del server: la suite di filo-security non è verde. Decidi tu: archiviarlo, o farlo rifare.';

function pratica(over = {}) {
  return Object.assign({
    _id: 'fb-1556', name: 'Lavoro del server fermo', text: 'Sistemare il cancello del server.',
    seq: 1255, subSeq: 0, status: 'design', statusReason: 'l5', statusPublic: 'open',
    clientId: 'owner:test', createdAt: '2026-10-20T08:00:00Z', images: [],
    notes: `Report di chi ha risolto: fatto.\n\n--- Aggiornamento dell'agente del 21/10/26, 15:43 ---\n${NOTA}`,
    // L'audit è passato poco prima della nota del cancello (ora locale, come la legge il marcatore).
    livelli: { l4: { esito: 'pass', at: new Date(2026, 9, 21, 15, 40).toISOString() } },
  }, over);
}

async function apri(page, lista, { pending = [], updateErr = '' } = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: cfg.pending, failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update') {
        window.__updates.push(msg);
        return cfg.updateErr ? { ok: false, error: cfg.updateErr } : { ok: true };
      }
      return orig(msg);
    };
  }, { pending, updateErr });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
}

const quadrato = (page) => page.locator('#mgLivelliRow .mg-forma[data-livello="l5"]');

async function apriQuadrato(page, id) {
  await page.evaluate((x) => window.__mgTest.openDetail(x), id);
  await expect(quadrato(page)).toHaveClass(/mg-forma--attack/);
  await quadrato(page).click();
}

test('ferma senza richiesta: il quadrato dice il motivo del server e rimanda in lavorazione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()]);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (1)');

  await apriQuadrato(page, 'fb-1556');
  const pannello = page.locator('#mgSideBody');
  await expect(pannello).toContainText('Il cancello non fonde il ramo del server');
  await expect(pannello).not.toContainText('non è (ancora) arrivata');
  // Il report di prima non passa per il motivo della fermata.
  await expect(pannello).not.toContainText('Report di chi ha risolto');

  const rimanda = page.locator('#mgL5RimandaBtn');
  const archivia = page.locator('#mgL5ArchiviaBtn');
  await expect(rimanda).toBeVisible();
  await expect(archivia).toBeVisible();
  await expect(rimanda).toHaveAttribute('title', /rifanno il lavoro/);

  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `tests/.shots/1556-fusione-senza-richiesta-${tema}.png` });
  }

  // Il commento di revisione parte con la strada scelta qui, come dalla riga dell'owner.
  await page.locator('#mgAcceptComment').fill('Rifallo senza toccare le regole.');
  await rimanda.click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const u = await page.evaluate(() => window.__updates[0]);
  expect(u).toMatchObject({ type: 'feedback_update', id: 'fb-1556', status: 'todo', reviewDecision: 'accepted', reviewComment: 'Rifallo senza toccare le regole.' });
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (0)');
  await expect(page.locator('#mgSide')).toBeHidden();
});

test('ferma senza richiesta: «Archivia» dal quadrato la archivia, e un rifiuto si legge nel pannello', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica()], { updateErr: 'scrittura respinta dal server' });
  await apriQuadrato(page, 'fb-1556');

  const archivia = page.locator('#mgL5ArchiviaBtn');
  await archivia.click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const u = await page.evaluate(() => window.__updates[0]);
  expect(u).toMatchObject({ type: 'feedback_update', id: 'fb-1556', status: 'archived', archiveOverride: 'archived' });
  // Il server ha detto no: lo dice dove l'owner ha premuto, e si può ripremere.
  await expect(page.locator('#mgL5StradeEsito')).toContainText('scrittura respinta dal server');
  await expect(archivia).toBeEnabled();
  await expect(page.locator('#mgL5RimandaBtn')).toBeEnabled();
});

test('ferma senza richiesta e senza nota: dice che nessuna richiesta è aperta, e la lista non promette un via libera', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [pratica({ notes: '' })]);

  const card = page.locator('.mg-item', { hasText: 'Lavoro del server fermo' });
  await expect(card.locator('.mg-fusione-badge')).toBeVisible();
  expect(await card.getAttribute('title')).not.toMatch(/via libera/);
  expect(await card.locator('.mg-fusione-badge').getAttribute('title')).toMatch(/rifarla o archiviarla/);

  await apriQuadrato(page, 'fb-1556');
  await expect(page.locator('#mgSideBody')).toContainText('Nessuna richiesta di fusione è aperta');
  await expect(page.locator('#mgL5RimandaBtn')).toBeVisible();
  await expect(page.locator('#mgL5ArchiviaBtn')).toBeVisible();
});

test('ferma senza nota del cancello: un report o una domanda di prima non passano per il motivo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const notes = 'Report di chi ha risolto: ho messo il tasto in alto.\n\n'
    + "--- Aggiornamento dell'agente del 19/10/26, 10:00 ---\nHo una domanda: il tasto lo preferisci a destra o a sinistra?\n\n"
    + '--- La tua risposta del 19/10/26, 11:00 ---\nA destra.\n\n'
    + "--- Aggiornamento dell'agente del 20/10/26, 09:00 ---\nReport: tasto spostato a destra, prove verdi.";
  await apri(page, [pratica({ notes })]);
  await apriQuadrato(page, 'fb-1556');
  const pannello = page.locator('#mgSideBody');
  await expect(pannello).toContainText('Nessuna richiesta di fusione è aperta');
  await expect(pannello).not.toContainText('tasto spostato a destra');
  await expect(pannello).not.toContainText('Quando');
  await expect(page.locator('#mgL5RimandaBtn')).toBeVisible();
  await expect(page.locator('#mgL5ArchiviaBtn')).toBeVisible();
});

test('con una richiesta aperta il quadrato resta quello di prima: Approva e Scarta, niente strade', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const richiesta = {
    id: 'ab12cd34ef56ab12cd34ef56', branch: 'claude/cancello', sha: 'a1b2c3d4'.repeat(5), who: 'secaudit',
    num: '#1255', feedbackId: 'fb-1556', origin: 'routine',
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules'], more: 0 }],
    createdAtMs: Date.now() - 60_000, expiresAtMs: Date.now() + 86_400_000, expired: false, used: false, discarded: false,
  };
  await apri(page, [pratica()], { pending: [richiesta] });
  await apriQuadrato(page, 'fb-1556');
  await expect(page.locator('#mgSideBody .sn-mac-btn-go')).toBeVisible();
  await expect(page.locator('#mgL5RimandaBtn')).toHaveCount(0);
  await expect(page.locator('#mgL5ArchiviaBtn')).toHaveCount(0);
});

// Il server scrive l'ora della nota in UTC senza fuso, l'owner la legge in Italia: la nota del cancello resta il motivo.
test.describe('letta in ora italiana', () => {
  let tzPrima;
  test.beforeAll(() => { tzPrima = process.env.TZ; process.env.TZ = 'Europe/Rome'; });
  test.afterAll(() => { if (tzPrima === undefined) delete process.env.TZ; else process.env.TZ = tzPrima; });

  test('ferma senza richiesta: la nota del server, scritta un quarto d’ora dopo l’audit, è il motivo', async ({ openTab }) => {
    const page = await openTab(MANAGE);
    const notes = `Report di chi ha risolto: fatto.\n\n--- Aggiornamento dell'agente del 21/10/26, 15:55 ---\n${NOTA}`;
    await apri(page, [pratica({ notes, livelli: { l4: { esito: 'pass', at: '2026-10-21T15:40:00.000Z' } } })]);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('Europe/Rome');
    await apriQuadrato(page, 'fb-1556');
    await expect(page.locator('#mgSideBody')).toContainText('Il cancello non fonde il ramo del server');
    await expect(page.locator('#mgSideBody')).not.toContainText('Nessuna richiesta di fusione è aperta');
  });
});

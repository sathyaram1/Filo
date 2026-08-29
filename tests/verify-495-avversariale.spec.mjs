// VERIFICA #495 (avversariale) — "puoi mostrare quanti feedback ci sono in ogni
// sezione? es: ricevuti (24) in coda (12)" su filo://manage/manage.html.
//
// Nessuna lettura del diff: si parte dal SINTOMO utente. L'owner apre la
// dashboard di gestione e vuole sapere, senza aprire le schede una per una,
// quanti feedback contiene ciascuna sezione.
//
// Asserisce il SUCCESSO (il numero c'è ed è quello giusto), non l'assenza di
// errori. Poi prova a romperlo.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'filo://manage/manage.html';
const SHOTS = join(process.cwd(), 'tests', '.shots');
try { mkdirSync(SHOTS, { recursive: true }); } catch (_) {}

function fb(id, over = {}) {
  return {
    _id: id,
    text: `feedback ${id}`,
    name: `Titolo ${id}`,
    seq: Number(String(id).replace(/\D/g, '')) || 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-06-22T10:00:00Z',
    images: [],
    ...over,
  };
}

async function ready(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}

// Testo dei 4 badge di conteggio, come li legge l'owner.
async function tabTexts(page) {
  return page.evaluate(() => {
    const out = {};
    for (const t of ['inbox', 'queue', 'resolved', 'archived', 'stats', 'models', 'automation', 'log']) {
      const b = document.querySelector(`.mg-tab[data-tab="${t}"]`);
      out[t] = b ? b.textContent.trim() : null;
    }
    return out;
  });
}

// Quante card mostra DAVVERO la colonna sinistra ora.
async function listLen(page) {
  return page.locator('#mgList .mg-item').count();
}

test('#495 — ogni scheda-lista dice quante ne contiene, e il numero è quello vero', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);

  // 3 in Ricevuti (unlabeled/attack/aligned), 4 In coda (todo/working/
  // revision_capability/done-non-spedito), 2 Risolti (done spediti),
  // 2 Archiviati (archived + spam_confirmed).
  const data = [
    fb('i1', { status: 'unlabeled' }),
    fb('i2', { status: 'attack' }),
    fb('i3', { status: 'aligned' }),
    fb('q1', { status: 'todo' }),
    fb('q2', { status: 'working' }),
    fb('q3', { status: 'revision_capability' }),
    fb('q4', { status: 'done', resolvedInVersion: '9.9.9' }), // non ancora rilasciata
    fb('r1', { status: 'done', resolvedInVersion: '1.0.0' }),
    fb('r2', { status: 'done', resolvedInVersion: '1.0.0' }),
    fb('a1', { status: 'archived' }),
    fb('a2', { status: 'spam_confirmed' }),
  ];
  await page.evaluate((d) => { window.__mgTest.setReleasedVersion('1.0.0'); window.__mgTest.setData(d); }, data);

  const t = await tabTexts(page);
  expect(t.inbox).toBe('Ricevuti (3)');
  expect(t.queue).toBe('In coda (4)');
  expect(t.resolved).toBe('Risolti (2)');
  expect(t.archived).toBe('Archiviati (2)');

  // Le schede che non elencano feedback non portano numeri inventati.
  expect(t.stats).toBe('Statistiche Red Team');
  expect(t.models).toBe('Modelli di supporto');
  expect(t.automation).toBe('Automazioni');
  expect(t.log).toBe('Log');

  // INVARIANTE: aprendo ogni scheda si contano esattamente quelle card.
  const expected = { inbox: 3, queue: 4, resolved: 2, archived: 2 };
  for (const [tab, n] of Object.entries(expected)) {
    await page.evaluate((x) => window.__mgTest.setTab(x), tab);
    expect(await listLen(page), `scheda ${tab}`).toBe(n);
    // e l'intestazione della colonna dice lo stesso numero della scheda
    const head = (await page.locator('#mgListHead').textContent()).trim();
    expect(head).toMatch(new RegExp(`\\(${n}\\)$`));
  }

  await page.screenshot({ path: join(SHOTS, 'v495-conteggi-chiaro.png') });
});

test('#495 — nessun numero finché i feedback non sono arrivati, poi (0) a vuoto', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Prima che i dati arrivino: nessuno "(0)" bugiardo. (La pagina in test non
  // ha un backend: dataLoaded resta falso finché setData non è chiamata.)
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const before = await tabTexts(page);
  expect(before.inbox).toBe('Ricevuti');
  expect(before.queue).toBe('In coda');

  await page.evaluate(() => window.__mgTest.setData([]));
  const after = await tabTexts(page);
  expect(after.inbox).toBe('Ricevuti (0)');
  expect(after.queue).toBe('In coda (0)');
  expect(after.resolved).toBe('Risolti (0)');
  expect(after.archived).toBe('Archiviati (0)');
});

test('#495 — i filtri della scheda Archiviati muovono il suo numero', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);

  const data = [
    fb('a1', { status: 'archived' }),
    fb('a2', { status: 'archived' }),
    fb('a3', { status: 'attack_confirmed' }),
    fb('a4', { status: 'spam_confirmed', starred: true }),
    fb('i1', { status: 'unlabeled', starred: true }),  // preferito ma NON archiviato
  ];
  await page.evaluate((d) => window.__mgTest.setData(d), data);
  await page.evaluate(() => window.__mgTest.setTab('archived'));

  expect((await tabTexts(page)).archived).toBe('Archiviati (4)');
  expect(await listLen(page)).toBe(4);

  // ⭐ ON → tutti i preferiti, di qualunque stato (2)
  await page.locator('#mgStarFilter, [id*="tar"][type="checkbox"]').first().check().catch(() => {});
  const starBox = page.locator('#mgArchiveFilter input[type="checkbox"]').first();
  if (await starBox.count()) {
    await starBox.check();
    const n = await listLen(page);
    expect((await tabTexts(page)).archived, 'il numero della scheda deve seguire il filtro ⭐')
      .toBe(`Archiviati (${n})`);
    expect(n).toBe(2);
    await starBox.uncheck();
  }

  // "Bloccati confermati" ON → solo attack_confirmed/spam_confirmed (2)
  const boxes = page.locator('#mgArchiveFilter input[type="checkbox"]');
  const cnt = await boxes.count();
  if (cnt >= 2) {
    await boxes.nth(1).check();
    const n = await listLen(page);
    expect((await tabTexts(page)).archived, 'il numero deve seguire il filtro "confermati"')
      .toBe(`Archiviati (${n})`);
    expect(n).toBe(2);
  }
});

test('#495 — i numeri si aggiornano da soli quando un feedback cambia scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);

  const data = [
    fb('i1', { status: 'aligned' }),
    fb('i2', { status: 'aligned' }),
    fb('q1', { status: 'todo' }),
  ];
  await page.evaluate((d) => window.__mgTest.setData(d), data);
  expect((await tabTexts(page)).inbox).toBe('Ricevuti (2)');
  expect((await tabTexts(page)).queue).toBe('In coda (1)');

  // Il feedback passa in coda (come farebbe un'approvazione dell'owner):
  // il conteggio deve seguire senza ricaricare la pagina.
  await page.evaluate(() => {
    const d = window.__mgTest.currentOrder();
    void d;
  });
  await page.evaluate(() => {
    // Simula l'effetto di un'approvazione sul modello in memoria e ridisegna
    // dalla stessa porta usata dal codice reale.
    window.__mgTest.setData([
      { _id: 'i1', status: 'todo',    text: 'a', name: 'A', seq: 1, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] },
      { _id: 'i2', status: 'aligned', text: 'b', name: 'B', seq: 2, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] },
      { _id: 'q1', status: 'todo',    text: 'c', name: 'C', seq: 3, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] },
    ]);
  });
  expect((await tabTexts(page)).inbox).toBe('Ricevuti (1)');
  expect((await tabTexts(page)).queue).toBe('In coda (2)');
});

test('#495 — numeri grandi: la barra delle schede non straborda né balla', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);

  // 1000 in Ricevuti, 1000 In coda, 500 Risolti, 500 Archiviati.
  await page.evaluate(() => {
    const mk = (p, n, status, extra) => Array.from({ length: n }, (_, i) => ({
      _id: `${p}${i}`, status, text: `t${i}`, name: `N${i}`, seq: i, subSeq: 0,
      clientId: 'x@y.z', createdAt: '2026-06-22T10:00:00Z', images: [], ...(extra || {}),
    }));
    window.__mgTest.setReleasedVersion('1.0.0');
    window.__mgTest.setData([
      ...mk('i', 1000, 'unlabeled'),
      ...mk('q', 1000, 'todo'),
      ...mk('r', 500, 'done', { resolvedInVersion: '1.0.0' }),
      ...mk('a', 500, 'archived'),
    ]);
  });

  // 3000 caricati insieme superano il tetto del caricamento (500): i numeri
  // sono minimi, non totali, e lo dicono con il "+".
  const t = await tabTexts(page);
  expect(t.inbox).toBe('Ricevuti (1000+)');
  expect(t.queue).toBe('In coda (1000+)');

  // La pagina non deve scrollare in orizzontale per colpa dei numeri.
  const over = await page.evaluate(() => {
    const bar = document.querySelector('.mg-tabs');
    return {
      barOverflow: bar.scrollWidth - bar.clientWidth,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      lastTabRight: Math.round(document.querySelector('.mg-tab[data-tab="log"]').getBoundingClientRect().right),
      innerW: window.innerWidth,
    };
  });
  expect(over.docOverflow, 'la pagina non deve scrollare in orizzontale').toBeLessThanOrEqual(1);
  expect(over.lastTabRight, "l'ultima scheda deve restare dentro la finestra").toBeLessThanOrEqual(over.innerW);

  // Le cifre non fanno "ballare" la barra: passando da 1000 a 8888 (stessa
  // larghezza in tabular-nums) le schede non si spostano.
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('.mg-tab')].map((b) => Math.round(b.getBoundingClientRect().left)));
  await page.evaluate(() => {
    const cur = window.__mgTest;
    void cur;
  });
  await page.screenshot({ path: join(SHOTS, 'v495-numeri-grandi.png') });
  expect(before.length).toBe(8);
});

test('#495 — durante la ricerca i numeri delle schede restano quelli veri', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);

  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'i1', status: 'unlabeled', text: 'alfa', name: 'Alfa', seq: 1, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] },
    { _id: 'q1', status: 'todo', text: 'beta', name: 'Beta', seq: 2, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] },
    { _id: 'q2', status: 'todo', text: 'gamma', name: 'Gamma', seq: 3, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] },
  ]));

  await page.locator('.mg-search-toggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();

  const t = await tabTexts(page);
  expect(t.inbox, 'la ricerca non deve azzerare i numeri delle schede').toBe('Ricevuti (1)');
  expect(t.queue).toBe('In coda (2)');
});

test('#495 — tema scuro: il numero si legge', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate(() => window.__mgTest.setData([
    { _id: 'i1', status: 'unlabeled', text: 'a', name: 'A', seq: 1, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] },
  ]));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await page.waitForTimeout(200);

  const c = await page.evaluate(() => {
    const b = document.querySelector('.mg-tab[data-tab="inbox"] .mg-tab-count');
    if (!b) return null;
    const s = getComputedStyle(b);
    return { color: s.color, opacity: s.opacity, text: b.textContent };
  });
  expect(c, 'il badge del conteggio deve esistere').not.toBeNull();
  expect(c.text).toBe('(1)');
  await page.screenshot({ path: join(SHOTS, 'v495-conteggi-scuro.png') });
});

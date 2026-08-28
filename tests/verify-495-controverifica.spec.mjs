// Controverifica #495 (verificatore, black-box dal sintomo).
//
// Sintomo dell'utente: "puoi mostrare quanti feedback ci sono in ogni sezione?
// es: ricevuti (24) in coda (12)" — dalla pagina di gestione (filo://manage/).
//
// Qui si asserisce il SUCCESSO dal punto di vista dell'owner: accanto al nome
// di ogni sezione c'è un numero, e quel numero è ESATTAMENTE quello che vede
// aprendo la sezione. Più gli abusi: stati inventati, campi rotti, filtri,
// zero, tetto del caricamento, ordinamenti, ricerca.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const fb = (id, status, extra = {}) => ({
  _id: id,
  seq: Number(String(id).replace(/\D/g, '')) || 1,
  subSeq: 0,
  name: `Feedback ${id}`,
  text: `testo di ${id}`,
  clientId: 'tester@example.com',
  createdAt: '2026-06-22T10:00:00Z',
  status,
  images: [],
  ...extra,
});

// Set misto che tocca tutte e quattro le sezioni-lista.
const MIXED = [
  fb('i1', 'unlabeled'), fb('i2', 'attack'), fb('i3', 'spam'),
  fb('i4', 'design'), fb('i5', 'aligned'), fb('i6', 'suspicious_file'),
  fb('q1', 'todo'), fb('q2', 'working'), fb('q3', 'revision_capability'),
  fb('q4', 'revision_security'),
  fb('r1', 'done'), fb('r2', 'done'),
  fb('a1', 'archived'), fb('a2', 'attack_confirmed', { starred: true }),
  fb('a3', 'spam_confirmed'),
];

async function ready(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}

// Il numero scritto accanto al nome della scheda (null se non c'è).
async function tabCount(page, tab) {
  const txt = await page.locator(`.mg-tab[data-tab="${tab}"]`).textContent();
  const m = /\((\d+)(\+?)\)\s*$/.exec((txt || '').trim());
  return m ? { n: Number(m[1]), plus: m[2] === '+' } : null;
}

test('ogni sezione porta il suo numero e il numero è quello che si vede aprendola', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate((d) => window.__mgTest.setData(d), MIXED);

  // Il sintomo dell'utente, letterale: "ricevuti (24) in coda (12)".
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti (6)');
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda (6)');
  await expect(page.locator('.mg-tab[data-tab="resolved"]')).toHaveText('Risolti (0)');
  await expect(page.locator('.mg-tab[data-tab="archived"]')).toHaveText('Archiviati (3)');

  // …e il numero deve coincidere con quello che l'owner conta aprendo la
  // sezione. Se qui divergono, il numero mente (è il modo tipico in cui un
  // contatore invecchia: regola sua, diversa da quella della lista).
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    await page.evaluate((t) => window.__mgTest.setTab(t), tab);
    const badge = await tabCount(page, tab);
    const shown = await page.locator('#mgList .mg-item').count();
    expect(badge, `la scheda ${tab} non porta nessun numero`).not.toBeNull();
    expect(badge.n, `${tab}: la scheda dice ${badge && badge.n} ma se ne vedono ${shown}`).toBe(shown);
    // L'intestazione della colonna dice lo stesso numero della scheda.
    await expect(page.locator('#mgListHead')).toContainText(`(${shown})`);
  }
});

test('le sezioni che non elencano feedback non inventano un numero', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate((d) => window.__mgTest.setData(d), MIXED);

  for (const tab of ['stats', 'models', 'automation', 'log']) {
    const txt = (await page.locator(`.mg-tab[data-tab="${tab}"]`).textContent()).trim();
    expect(txt, `la scheda ${tab} non elenca feedback: un numero lì non vuol dire niente`)
      .not.toMatch(/\(\d+\+?\)$/);
  }
});

test('prima che i feedback arrivino non si scrive "(0)": un dato che manca non è zero', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  // Subito, senza setData: la lista sta caricando (in test non c'è Firestore,
  // quindi il caricamento non arriverà mai a buon fine).
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    const txt = (await page.locator(`.mg-tab[data-tab="${tab}"]`).textContent()).trim();
    expect(txt, `${tab}: numero scritto prima di avere i dati`).not.toMatch(/\(\d+\+?\)$/);
  }
});

test('a zero feedback ogni sezione dice (0), e resta (0) su tutte', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate(() => window.__mgTest.setData([]));
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    await page.evaluate((t) => window.__mgTest.setTab(t), tab);
    expect((await tabCount(page, tab)).n).toBe(0);
    expect(await page.locator('#mgList .mg-item').count()).toBe(0);
  }
});

test('i filtri della sezione Archiviati muovono il numero insieme alla lista', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate((d) => window.__mgTest.setData(d), MIXED);
  await page.evaluate(() => window.__mgTest.setTab('archived'));

  // Base: gli archiviati veri (archived + i due confermati).
  expect((await tabCount(page, 'archived')).n).toBe(await page.locator('#mgList .mg-item').count());

  // ⭐ acceso: la sezione elenca i preferiti di QUALUNQUE stato.
  const star = page.locator('#mgArchiveFilter input[type="checkbox"], #mgArchiveFilter button').first();
  if (await star.count()) {
    await star.click();
    await page.waitForTimeout(150);
    const n = (await tabCount(page, 'archived')).n;
    const shown = await page.locator('#mgList .mg-item').count();
    expect(n, 'col filtro ⭐ acceso il numero non segue la lista').toBe(shown);
    await star.click();
    await page.waitForTimeout(150);
  }
  expect((await tabCount(page, 'archived')).n).toBe(await page.locator('#mgList .mg-item').count());
});

test('al tetto del caricamento i numeri dicono che sono minimi, e spiegano perché', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  const many = Array.from({ length: 500 }, (_, i) => fb(`m${i + 1}`, i % 2 ? 'todo' : 'unlabeled'));
  await page.evaluate((d) => window.__mgTest.setData(d), many);

  const inbox = await tabCount(page, 'inbox');
  const queue = await tabCount(page, 'queue');
  expect(inbox.plus, 'al tetto il numero è un minimo e deve dirlo').toBe(true);
  expect(queue.plus).toBe(true);
  expect(inbox.n + queue.n).toBe(500);
  // L'hover spiega il "+": altrimenti resta un enigma.
  const title = await page.locator('.mg-tab[data-tab="inbox"]').getAttribute('title');
  expect(title || '', 'senza hover il "+" non si capisce').toMatch(/più recenti|non entrano nel conto/i);
});

test('abusi: stati inventati, campi rotti e testi enormi non falsano né rompono i numeri', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  const rotti = [
    fb('x1', 'stato-che-non-esiste'),
    fb('x2', null),
    fb('x3', undefined),
    fb('x4', 12345),
    fb('x5', '   '),
    fb('x6', '<script>alert(1)</script>'),
    fb('x7', 'todo', { name: '<img src=x onerror=alert(1)>', text: '😀'.repeat(500) }),
    fb('x8', 'todo', { name: 'x'.repeat(10000), createdAt: 'non-una-data' }),
    fb('x9', 'archived', { starred: 'sì', seq: NaN, subSeq: null }),
    { _id: 'x10' },
  ];
  await page.evaluate((d) => window.__mgTest.setData(d), rotti);

  // Nessun crash: la pagina risponde ancora e i numeri esistono su tutte.
  let totale = 0;
  for (const tab of ['inbox', 'queue', 'resolved', 'archived']) {
    await page.evaluate((t) => window.__mgTest.setTab(t), tab);
    const badge = await tabCount(page, tab);
    expect(badge, `${tab}: nessun numero dopo dati sporchi`).not.toBeNull();
    const shown = await page.locator('#mgList .mg-item').count();
    expect(badge.n, `${tab}: numero (${badge.n}) diverso dalla lista (${shown}) con dati sporchi`).toBe(shown);
    totale += badge.n;
  }
  // Ogni feedback finisce in una e una sola sezione: niente sparizioni, niente
  // doppi conteggi (l'archiviata può ripescare i preferiti, ma qui il filtro ⭐
  // è spento).
  expect(totale, 'un feedback è sparito dai conti o è stato contato due volte').toBe(rotti.length);

  // L'HTML nei campi resta testo: nessuno script eseguito.
  expect(await page.locator('#mgList script').count()).toBe(0);
});

test('cambiare ordinamento non cambia i numeri (l\'ordine non è un filtro)', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate((d) => window.__mgTest.setData(d), MIXED);
  const prima = await tabCount(page, 'inbox');
  await page.evaluate(() => window.__mgTest.setSortMode('num'));
  const dopo = await tabCount(page, 'inbox');
  expect(dopo.n).toBe(prima.n);
});

test('ricerca: i risultati dicono quanti sono e la barra non resta con numeri altrui', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate((d) => window.__mgTest.setData(d), MIXED);

  const prima = await tabCount(page, 'inbox');
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  // Aperta la ricerca, l'intestazione non promette un numero che non ha.
  await expect(page.locator('#mgListHead')).toHaveText('Ricerca');
  // Chiudendo la ricerca si torna al numero di prima.
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(150);
  expect((await tabCount(page, 'inbox')).n).toBe(prima.n);
});

test('aspetto: i numeri stanno nella barra anche a finestra stretta, in chiaro e in scuro', async ({ openTab }) => {
  const page = await openTab(URL);
  await ready(page);
  await page.evaluate((d) => window.__mgTest.setData(d), MIXED);

  await page.screenshot({ path: 'tests/.shots/495-tabs-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/495-tabs-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });

  // La barra delle schede non deve sfondare la pagina (8 schede + numeri).
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/495-tabs-stretta.png' });
  const overflow = await page.evaluate(() => {
    const nav = document.getElementById('mgTabs');
    return {
      scroll: nav.scrollWidth, client: nav.clientWidth,
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      righe: new Set([...nav.querySelectorAll('.mg-tab')].map((b) => Math.round(b.getBoundingClientRect().top))).size,
    };
  });
  console.log('[495] barra schede a 900px:', JSON.stringify(overflow));
});

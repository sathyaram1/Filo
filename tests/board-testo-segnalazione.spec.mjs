// Spec: sotto il titolo di ogni problema risolto la bacheca mostra il testo della segnalazione che il server ha
// ripulito e corretto (`publicText` sulla scheda pubblica, #987). Corto si legge intero; lungo sta in tre righe e si
// apre intero al passaggio del puntatore, sopra le schede sotto, che non si spostano. Sempre testo, mai HTML.
// Cammino vero: loadData → runQuery su `feedback-public` con un doppio della rete che, come Firestore, rimanda
// SOLO i campi chiesti (`select`): una bacheca che non chiede il campo non lo vede.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const PUBBLICATA = '2026-09-01T10:00:00.000Z';

const scheda = (id, seq, extra) => Object.assign({
  _id: id, name: `Fix ${seq}`, seq, subSeq: 0, status: 'done', statusPublic: 'closed',
  resolvedInVersion: '0.2.70', createdAt: `2026-08-${String(10 + seq).padStart(2, '0')}T10:00:00.000Z`,
  publishedAt: PUBBLICATA,
}, extra);

const CORTO = 'Il timer non suona più quando finisce. L’ho provato due volte.';
const LUNGO = [
  'Quando apro una scheda nuova e scrivo nella barra, i suggerimenti compaiono in ritardo.',
  'Succede soprattutto dopo aver lasciato Filo aperto per qualche ora.',
  '',
  'Passi:',
  '- apro tre schede',
  '- lascio il computer in sospensione',
  '- riapro e scrivo «meteo»',
  '',
  'Mi aspettavo i suggerimenti subito, come la prima volta. FINE-DEL-TESTO-LUNGO',
].join('\n');
const OSTILE = '<img src=x onerror="window.__xss=1"><b>grassetto</b> 🙂 e niente di più';

const SCHEDE = [
  scheda('t-corto', 1, { name: 'Timer muto', publicText: CORTO }),
  scheda('t-lungo', 2, { name: 'Suggerimenti lenti', publicText: LUNGO }),
  scheda('t-ostile', 3, { name: 'Titolo qualunque', publicText: OSTILE }),
  scheda('t-spazi', 4, { name: 'Solo spazi', publicText: '   \n  ' }),
  scheda('t-senza', 5, { name: 'Senza testo' }),
];

async function reteFinta(page, docs) {
  await page.addInitScript((base) => {
    window.__campiChiesti = [];
    const fsDoc = (c, campi) => {
      const fields = {};
      for (const [k, v] of Object.entries(c)) {
        if (k.startsWith('_') || (campi && !campi.includes(k))) continue;
        fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
      }
      return { name: `projects/p/databases/(default)/documents/feedback-public/${c._id}`, fields,
        createTime: '2026-09-01T10:00:00Z', updateTime: '2026-09-01T10:00:00Z' };
    };
    const vera = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String((input && input.url) || input || '');
      if (!url.includes('firestore.googleapis.com')) return vera(input, init);
      let q = null;
      try { q = JSON.parse((init && init.body) || '{}').structuredQuery; } catch (_) {}
      if (!q || q.from?.[0]?.collectionId !== 'feedback-public') {
        return new Response(JSON.stringify({ error: { code: 403 } }), { status: 403 });
      }
      const campi = q.select && Array.isArray(q.select.fields) ? q.select.fields.map((f) => f.fieldPath) : null;
      window.__campiChiesti.push(campi);
      let righe = base;
      if (q.where) {
        const da = String(q.where.fieldFilter?.value?.stringValue || '');
        righe = base.filter((c) => String(c.publishedAt) > da);
      } else if (q.startAt) {
        righe = [];
      }
      righe = righe.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return new Response(JSON.stringify(righe.map((c) => ({ document: fsDoc(c, campi) }))), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    };
  }, docs);
}

async function pronta(page) {
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
}

async function apri(openTab, { primaDelRicarico } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, SCHEDE);
  if (primaDelRicarico) await primaDelRicarico(page);
  await page.reload();
  await pronta(page);
  await page.evaluate(() => window.__boardTest.setReleasedVersion('0.2.71'));
  await expect(page.locator('.bd-card')).toHaveCount(SCHEDE.length);
  return page;
}

const carta = (page, titolo) => page.locator('.bd-card', { has: page.locator('.bd-card-title', { hasText: titolo }) });

test('sotto il titolo di un problema risolto c’è il testo ripulito della segnalazione', async ({ openTab }) => {
  const page = await apri(openTab);
  const c = carta(page, 'Timer muto');
  await expect(c.locator('.bd-card-text')).toHaveText(CORTO);

  // Sotto il titolo, prima del numero.
  const ordine = await c.locator('.bd-card-main').evaluate((m) => [...m.children].map((x) => x.className));
  expect(ordine).toEqual(['bd-card-title', 'bd-card-testo', 'bd-card-sub']);
  const titolo = await c.locator('.bd-card-title').boundingBox();
  const testo = await c.locator('.bd-card-text').boundingBox();
  expect(testo.y).toBeGreaterThanOrEqual(titolo.y + titolo.height - 1);

  // La bacheca il campo lo chiede: senza, Firestore non lo rimanda.
  const chiesti = await page.evaluate(() => window.__campiChiesti);
  expect(chiesti.length).toBeGreaterThan(0);
  for (const campi of chiesti) expect(campi).toContain('publicText');

  // Corto: niente da aprire.
  await expect(c.locator('.bd-card-testo')).not.toHaveClass(/lungo/);
  await c.locator('.bd-card-text').hover();
  await page.waitForTimeout(500);
  await expect(c.locator('.bd-card-intero')).toBeHidden();
});

test('un testo lungo sta in tre righe e si apre intero al passaggio del puntatore, senza spostare le schede', async ({ openTab }) => {
  const page = await apri(openTab);
  const c = carta(page, 'Suggerimenti lenti');
  const box = c.locator('.bd-card-testo');
  await expect(box).toHaveClass(/lungo/);
  const righe = await c.locator('.bd-card-text').evaluate((el) => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
  expect(righe).toBe(3);
  await expect(c.locator('.bd-card-intero')).toBeHidden();

  const sotto = carta(page, 'Timer muto');
  const prima = await sotto.boundingBox();
  await c.locator('.bd-card-text').hover();
  const intero = c.locator('.bd-card-intero');
  await expect(intero).toBeVisible();
  expect(await intero.evaluate((el) => el.textContent)).toBe(LUNGO);
  await expect(intero).toContainText('FINE-DEL-TESTO-LUNGO');
  const finale = await intero.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const rects = r.getClientRects();
    const ultimo = rects[rects.length - 1];
    const b = el.getBoundingClientRect();
    return { dentro: ultimo.bottom <= b.bottom + 1, ultimo: ultimo.bottom, fondo: b.bottom };
  });
  expect(finale.dentro, JSON.stringify(finale)).toBe(true);
  expect(await sotto.boundingBox()).toEqual(prima);
  const opaco = () => intero.evaluate((el) => getComputedStyle(el).opacity);
  await expect.poll(opaco).toBe('1');
  await page.screenshot({ path: 'tests/.shots/board-testo-lungo-chiaro.png' });

  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await c.locator('.bd-card-title').hover();
  await c.locator('.bd-card-text').hover();
  await expect(intero).toBeVisible();
  await expect.poll(opaco).toBe('1');
  await page.screenshot({ path: 'tests/.shots/board-testo-lungo-scuro.png' });

  // Via dal testo si richiude; col fuoco (tastiera) si riapre.
  await page.mouse.move(2, 2);
  await expect(intero).toBeHidden();
  await box.focus();
  await expect(intero).toBeVisible();
});

test('il testo si mostra come testo: niente HTML, niente vuoti', async ({ openTab }) => {
  const page = await apri(openTab);
  const c = carta(page, 'Titolo qualunque');
  await expect(c.locator('.bd-card-text')).toHaveText(OSTILE);
  await expect(c.locator('img, b')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  await expect(carta(page, 'Solo spazi').locator('.bd-card-testo')).toHaveCount(0);
  await expect(carta(page, 'Senza testo').locator('.bd-card-testo')).toHaveCount(0);
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.screenshot({ path: 'tests/.shots/board-testo-scuro.png', fullPage: true });
});

test('una copia su disco di prima del testo non lo nasconde', async ({ openTab }) => {
  // La copia salvata da una versione che non chiedeva il campo: per l'orologio è fresca, e non ha niente di cambiato
  // da chiedere (segnalibro alla pari). Valida, la bacheca resterebbe senza testo per ore.
  const page = await apri(openTab, {
    primaDelRicarico: (p) => p.evaluate(({ schede, segnalibro }) => chrome.storage.local.set({
      sn_board_schede: { at: Date.now(), cards: schede, after: null, complete: true, segnalibro },
    }), {
      schede: SCHEDE.map(({ publicText, ...resto }) => resto),
      segnalibro: PUBBLICATA,
    }),
  });
  await expect(carta(page, 'Timer muto').locator('.bd-card-text')).toHaveText(CORTO);
});

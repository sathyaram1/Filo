// Verifica #987 giro 2 (prove dei rilievi). Base copiata dallo spec della bacheca.
// Spec: sotto il titolo di ogni problema risolto la bacheca mostra il testo della segnalazione che il server ha
// ripulito e corretto (`publicText` sulla scheda pubblica, #987). Corto si legge intero; lungo sta in tre righe e si
// apre intero al passaggio del puntatore, sopra le schede sotto, che non si spostano. Sempre testo, mai HTML.
// Cammino vero: loadData → runQuery su `feedback-public` con un doppio della rete che, come Firestore, rimanda
// SOLO i campi chiesti (`select`): una bacheca che non chiede il campo non lo vede.

import { test, expect } from '../../fixtures/electron.mjs';

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

async function apri(openTab, { primaDelRicarico, schede = SCHEDE } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await pronta(page);
  await reteFinta(page, schede);
  if (primaDelRicarico) await primaDelRicarico(page);
  await page.reload();
  await pronta(page);
  await page.evaluate(() => window.__boardTest.setReleasedVersion('0.2.71'));
  await expect(page.locator('.bd-card')).toHaveCount(schede.length);
  return page;
}



const carta = (page, titolo) => page.locator('.bd-card', { has: page.locator('.bd-card-title', { hasText: titolo }) });
const PARAGRAFO = 'Quando apro il timer dalla barra laterale e imposto dieci minuti, alla fine non suona niente, anche se il volume del sistema è alto e le notifiche sono attive. Succede sia con le cuffie sia senza, e anche dopo aver riavviato Filo. Mi aspettavo almeno un suono o una notifica sullo schermo.';
const MOLTO_LUNGO = Array.from({ length: 80 }, (_, i) => `Riga ${i + 1}: il timer non suona e il volume resta muto.`).join('\n').replace('Riga 1:', 'PRIMA-RIGA');

test('r1 i pulsanti del voto stanno allo stesso posto su una scheda con testo lungo e su una con testo corto', async ({ openTab }) => {
  const schede = [
    scheda('t-par', 1, { name: 'Timer muto', publicText: PARAGRAFO }),
    scheda('t-corto', 2, { name: 'Corto', publicText: 'Il timer non suona.' }),
  ];
  const page = await apri(openTab, { schede });
  const pos = async (t) => {
    const c = carta(page, t);
    const v = await c.locator('.bd-vote').boundingBox();
    const ti = await c.locator('.bd-card-title').boundingBox();
    return { destra: Math.round(v.x + v.width), alto: Math.round(v.y), titolo: Math.round(ti.y) };
  };
  const lungo = await pos('Timer muto');
  const corto = await pos('Corto');
  await page.screenshot({ path: 'tests/.shots/v987g2-r1-voti.png' });
  // Stesso bordo destro: chi scorre la bacheca trova il voto sempre nello stesso punto della scheda.
  expect(Math.abs(lungo.destra - corto.destra), JSON.stringify({ lungo, corto })).toBeLessThanOrEqual(2);
});

test('r2 il testo intero di una scheda la cui cima è sopra il bordo della finestra si legge dalla prima riga', async ({ openTab }) => {
  const schede = [
    ...Array.from({ length: 6 }, (_, i) => scheda(`t-n${i}`, 1 + i, { name: `Riempitivo ${i}`, publicText: 'Breve.' })),
    scheda('t-lungo', 9, { name: 'Lunghissimo', publicText: MOLTO_LUNGO }),
    ...Array.from({ length: 6 }, (_, i) => scheda(`t-m${i}`, 20 + i, { name: `Dopo ${i}`, publicText: 'Breve.' })),
  ];
  const page = await apri(openTab, { schede });
  const corto = carta(page, 'Lunghissimo').locator('.bd-card-text');
  // La scheda in alto, con le prime righe del testo già sopra il bordo: si passa sull'ultima riga visibile.
  await corto.evaluate((el) => { const r = el.getBoundingClientRect(); window.scrollBy(0, r.top + 30); });
  const b = await corto.boundingBox();
  await page.mouse.move(b.x + 40, b.y + b.height - 6);
  const intero = carta(page, 'Lunghissimo').locator('.bd-card-intero');
  await expect.poll(() => intero.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(400);
  const prima = await intero.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const rs = r.getClientRects();
    return { cima: rs[0].top, visibile: getComputedStyle(el).opacity };
  });
  await page.screenshot({ path: 'tests/.shots/v987g2-r2-cima.png' });
  expect(prima.cima, JSON.stringify(prima)).toBeGreaterThanOrEqual(0);
});

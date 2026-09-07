// #497 — verifica avversariale: la frase per chi ha segnalato parte CHIUSA e
// tutti i tasti stanno sulla stessa riga (filo://manage/manage.html).
//
// Black-box dal sintomo: l'owner apre una segnalazione nella dashboard di
// gestione e vuole (a) non vedersi mangiare mezzo dettaglio dalla casella della
// frase, (b) trovare i tasti su una riga sola.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(over) {
  return {
    _id: 'x', text: 'Il bottone non fa niente', name: 'Bottone morto',
    seq: 700, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-09-01T10:00:00Z', images: [],
    status: 'todo', statusPublic: 'open', notes: '', ...over,
  };
}

const CASI = [
  ['ricevuto non filtrato', fb({ _id: 'c1', status: null, statusPublic: 'open' }), 'inbox'],
  ['ricevuto file sospetto', fb({ _id: 'c2', status: 'suspicious_file', statusPublic: 'open' }), 'inbox'],
  ['in coda', fb({ _id: 'c3', status: 'todo' }), 'queue'],
  ['in lavorazione', fb({ _id: 'c4', status: 'working' }), 'queue'],
  ['risolto', fb({ _id: 'c5', status: 'done', statusPublic: 'closed', userNote: 'Ora funziona.' }), 'resolved'],
  ['archiviato', fb({ _id: 'c6', status: 'archived', statusPublic: 'closed' }), 'archived'],
  ['stato cifrato', fb({ _id: 'c7', status: 'enc:v1:qqqq', statusPublic: 'open' }), 'inbox'],
];

async function prepara(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
  });
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
}

async function apri(page, id, tab) {
  await page.evaluate(({ i, t }) => {
    window.__mgTest.setTab(t);
    window.__mgTest.openDetail(i);
  }, { i: id, t: tab });
  await expect(page.locator('#mgDetail')).toBeVisible();
}

test('#497 A — la frase parte chiusa su OGNI stato della segnalazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, CASI.map(([, f]) => f));
  for (const [nome, f, tab] of CASI) {
    await apri(page, f._id, tab);
    await expect(page.locator('#mgUserNote'), nome).toBeHidden();
    await expect(page.locator('#mgUserNoteToggle'), nome).toHaveAttribute('aria-expanded', 'false');
    // Il tasto per aprirla c'è sempre (anche su stato cifrato: la frase è in chiaro)
    await expect(page.locator('#mgUserNoteToggle'), nome).toBeVisible();
  }
});

test('#497 B — tutti i tasti dell owner su UNA riga (caso peggiore: 4 azioni + preferito + frase)', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, CASI.map(([, f]) => f));
  await apri(page, 'c2', 'inbox');   // file sospetto: accept + attacco + spam + archivia

  const bottoni = page.locator('#mgOwnerBar button:visible');
  const n = await bottoni.count();
  expect(n, 'quante azioni offre il caso peggiore').toBeGreaterThanOrEqual(6);

  const box = [];
  for (let i = 0; i < n; i++) box.push(await bottoni.nth(i).boundingBox());
  const tops = box.map((b) => Math.round(b.y));
  const min = Math.min(...tops), max = Math.max(...tops);
  console.log('TOPS', JSON.stringify(tops), 'label', await bottoni.allTextContents());
  expect(max - min, `i tasti non sono sulla stessa riga: ${JSON.stringify(tops)}`).toBeLessThanOrEqual(4);

  // e non devono sbordare dalla colonna del dettaglio
  const col = await page.locator('#mgDetailCol').boundingBox();
  for (const b of box) {
    expect(b.x).toBeGreaterThanOrEqual(col.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(col.x + col.width + 1);
  }
});

test('#497 C — apri/chiudi: il tasto apre col cursore dentro, richiude, e il doppio clic non lascia a metà', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, CASI.map(([, f]) => f));
  await apri(page, 'c3', 'queue');

  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNote')).toBeVisible();
  await expect(page.locator('#mgUserNoteText')).toBeFocused();
  await expect(page.locator('#mgUserNoteToggle')).toHaveAttribute('aria-expanded', 'true');

  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNote')).toBeHidden();

  // doppio clic rapido: torna al punto di partenza, coerente con aria-expanded
  await page.locator('#mgUserNoteToggle').dblclick();
  const visibile = await page.locator('#mgUserNote').isVisible();
  const espanso = await page.locator('#mgUserNoteToggle').getAttribute('aria-expanded');
  expect(String(visibile)).toBe(espanso === 'true' ? 'true' : 'false');
});

test('#497 D — bozza: chiudere la sezione non butta via quello che avevo scritto', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, CASI.map(([, f]) => f));
  await apri(page, 'c3', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Bozza in corso');
  await page.locator('#mgUserNoteToggle').click();          // richiudo
  await page.locator('#mgUserNoteToggle').click();          // riapro
  await expect(page.locator('#mgUserNoteText')).toHaveValue('Bozza in corso');
});

test('#497 E — la frase già scritta si vede da CHIUSA (il tasto lo dice)', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, CASI.map(([, f]) => f));
  await apri(page, 'c5', 'resolved');   // ha userNote: 'Ora funziona.'
  await expect(page.locator('#mgUserNote')).toBeHidden();
  const t = page.locator('#mgUserNoteToggle');
  const title = await t.getAttribute('title');
  console.log('TITLE PIENA', title);
  expect(String(title)).toContain('Ora funziona.');

  // e su una senza frase il tasto NON deve fingere che ci sia
  await apri(page, 'c3', 'queue');
  const t2 = await page.locator('#mgUserNoteToggle').getAttribute('title');
  console.log('TITLE VUOTA', t2);
  expect(String(t2)).not.toContain('già scritta');
});

test('#497 F — un errore di salvataggio a sezione chiusa non resta invisibile', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, CASI.map(([, f]) => f));
  await apri(page, 'c3', 'queue');
  await page.evaluate(() => {
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: false, error: 'rete giù' };
      return { ok: true };
    };
  });
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Provo');
  await page.locator('#mgUserNoteBtn').click();
  await expect(page.locator('#mgUserNoteMsg')).toBeVisible();
  await expect(page.locator('#mgUserNote')).toBeVisible();
});

test('#497 G — HTML e caratteri speciali nella frase non finiscono nel markup', async ({ openTab }) => {
  const cattiva = '<img src=x onerror=alert(1)>"\'</textarea><script>window.__pwn=1</script> 😀';
  const page = await openTab(URL);
  await prepara(page, [fb({ _id: 'xss', status: 'done', statusPublic: 'closed', userNote: cattiva })]);
  await apri(page, 'xss', 'resolved');
  expect(await page.evaluate(() => window.__pwn)).toBeUndefined();
  expect(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length)).toBe(0);
  const title = await page.locator('#mgUserNoteToggle').getAttribute('title');
  expect(String(title)).toContain('onerror');
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNoteText')).toHaveValue(cattiva);
});

test('#497 H — 10.000 caratteri: cosa arriva davvero al destinatario', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, [fb({ _id: 'lungo', status: 'todo' })]);
  await apri(page, 'lungo', 'queue');
  await page.locator('#mgUserNoteToggle').click();
  const lungo = 'a'.repeat(10000);
  await page.locator('#mgUserNoteText').fill(lungo);
  await page.locator('#mgUserNoteBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const inviato = await page.evaluate(() => window.__updates[0].userNote.length);
  const msg = await page.locator('#mgUserNoteMsg').textContent();
  console.log('LUNGHEZZA INVIATA', inviato, 'MESSAGGIO', msg);
  // il campo resta com'era o avvisa? registro entrambi
  const valoreDopo = await page.locator('#mgUserNoteText').inputValue();
  console.log('VALORE DOPO', valoreDopo.length);
});

test('#497 I — la riga dei tasti in una colonna stretta non taglia niente', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, CASI.map(([, f]) => f));
  await apri(page, 'c2', 'inbox');
  await page.evaluate(() => {
    const c = document.getElementById('mgDetailCol');
    c.style.width = '360px'; c.style.flex = '0 0 360px';
  });
  await page.waitForTimeout(200);
  const bottoni = page.locator('#mgOwnerBar button:visible');
  const n = await bottoni.count();
  const col = await page.locator('#mgDetailCol').boundingBox();
  const righe = new Set();
  for (let i = 0; i < n; i++) {
    const b = await bottoni.nth(i).boundingBox();
    righe.add(Math.round(b.y / 10));
    expect(b.x + b.width, `il tasto ${i} sborda dalla colonna`).toBeLessThanOrEqual(col.x + col.width + 1);
  }
  console.log('RIGHE A 360px', righe.size);
  // niente scorrimento orizzontale del dettaglio
  const over = await page.evaluate(() => {
    const d = document.getElementById('mgDetail');
    return d.scrollWidth - d.clientWidth;
  });
  expect(over, 'il dettaglio scorre in orizzontale').toBeLessThanOrEqual(1);
});

test('#497 J — screenshot chiaro e scuro della barra', async ({ openTab }) => {
  const page = await openTab(URL);
  await prepara(page, CASI.map(([, f]) => f));
  await apri(page, 'c2', 'inbox');
  await page.screenshot({ path: 'tests/.shots/497-barra-chiaro.png' });
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/497-barra-scuro.png' });
  await apri(page, 'c5', 'resolved');
  await page.locator('#mgUserNoteToggle').click();
  await page.screenshot({ path: 'tests/.shots/497-frase-aperta-scuro.png' });
});

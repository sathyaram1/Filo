// Verifica avversariale #497 — giro 2.
//
// Sintomo: nella dashboard di gestione la sezione con la frase per chi ha
// segnalato deve partire CHIUSA, e tutti gli altri tasti devono stare sulla
// STESSA riga.
//
// Qui si ri-provano anche le porte trovate al giro 1 (la frase scritta e non
// salvata che spariva premendo un tasto di stato, la riga che andava a capo a
// 1280, il messaggio d'esito che spingeva i tasti a capo, la sezione che si
// richiudeva da sola su un aggiornamento remoto).

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const BASE = {
  _id: 'v497-1',
  text: 'Il tasto non fa niente',
  name: 'Tasto muto',
  seq: 497,
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-09-01T10:00:00Z',
  images: [],
  notes: 'Report della lavorazione.',
};

const CASI = [
  { nome: 'ricevuta non filtrata', tab: 'inbox',    fb: { status: 'new' } },
  { nome: 'file sospetto',         tab: 'inbox',    fb: { status: 'suspicious_file' } },
  { nome: 'in coda',               tab: 'queue',    fb: { status: 'todo', reviewDecision: 'accepted' } },
  { nome: 'in lavorazione',        tab: 'queue',    fb: { status: 'working', reviewDecision: 'accepted' } },
  { nome: 'risolta',               tab: 'resolved', fb: { status: 'done', statusPublic: 'closed' } },
  { nome: 'archiviata',            tab: 'archived', fb: { status: 'archived' } },
  { nome: 'stato cifrato',         tab: 'inbox',    fb: { status: 'FENC1:blob', statusPublic: 'open' } },
];

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
}

async function apri(page, fb, tab) {
  await page.evaluate(({ f, t }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([f]);
    window.__mgTest.setTab(t);
    window.__mgTest.openDetail(f._id);
  }, { f: fb, t: tab });
}

// Rettangoli dei tasti VISIBILI della barra dell'owner, nell'ordine in cui
// stanno in pagina.
function tasti(page) {
  return page.evaluate(() => {
    const sel = '#mgActionsRow button, #mgStarBtn, #mgUserNoteToggle';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      out.push({ testo: (el.textContent || '').trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }
    return {
      tasti: out,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      detail: (() => { const d = document.getElementById('mgDetail'); const r = d.getBoundingClientRect(); return { left: r.left, right: r.right }; })(),
    };
  });
}

function unaRigaSola(geo, dove) {
  const t = geo.tasti;
  expect(t.length, `${dove}: nessun tasto`).toBeGreaterThan(1);
  const primo = t[0];
  for (const b of t) {
    const coperta = Math.min(primo.bottom, b.bottom) - Math.max(primo.top, b.top);
    const meta = Math.min(primo.bottom - primo.top, b.bottom - b.top) / 2;
    expect(coperta, `${dove}: «${b.testo}» non è sulla riga di «${primo.testo}»`).toBeGreaterThan(meta);
  }
}

test('#497 — la sezione della frase parte chiusa su ogni stato', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  for (const c of CASI) {
    const fb = { ...BASE, ...c.fb, _id: `v497-${c.tab}-${c.nome}` };
    await apri(page, fb, c.tab);
    await expect(page.locator('#mgUserNote'), `${c.nome}: la sezione è aperta`).toBeHidden();
    expect(await page.locator('#mgUserNoteToggle').getAttribute('aria-expanded'), c.nome).toBe('false');
    // ...e con una frase GIÀ scritta resta comunque chiusa, ma il tasto lo dice.
    const conFrase = { ...fb, _id: `${fb._id}-frase`, userNote: 'Ora funziona.' };
    await apri(page, conFrase, c.tab);
    await expect(page.locator('#mgUserNote'), `${c.nome} (con frase): la sezione è aperta`).toBeHidden();
    const t = page.locator('#mgUserNoteToggle');
    await expect(t).toHaveClass(/mg-usernote-piena/);
    expect(await t.getAttribute('title')).toContain('Ora funziona.');
  }
});

test('#497 — tutti i tasti sulla stessa riga, a 1280 e più stretto', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(1280, 800);
  });
  const page = await openTab(URL);
  await pronta(page);
  for (const c of CASI) {
    const fb = { ...BASE, ...c.fb, _id: `v497-riga-${c.nome}` };
    await apri(page, fb, c.tab);
    const geo = await tasti(page);
    unaRigaSola(geo, `${c.nome} @1280`);
    for (const b of geo.tasti) {
      expect(b.right, `${c.nome}: «${b.testo}» sfora la colonna`).toBeLessThanOrEqual(geo.detail.right + 1);
    }
    expect(geo.scrollWidth, `${c.nome}: la pagina scorre di lato`).toBeLessThanOrEqual(geo.clientWidth + 1);
  }
  // Aperta anche la sezione della frase: la riga dei tasti non deve cambiare.
  await apri(page, { ...BASE, status: 'suspicious_file', _id: 'v497-riga-aperta' }, 'inbox');
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNote')).toBeVisible();
  unaRigaSola(await tasti(page), 'file sospetto, frase aperta @1280');
});

test('#497 — colonna stretta: i tasti vanno a capo interi, niente scorrimento laterale', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, status: 'suspicious_file' }, 'inbox');
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(200);
  const geo = await tasti(page);
  for (const b of geo.tasti) {
    expect(b.right, `«${b.testo}» tagliato`).toBeLessThanOrEqual(geo.clientWidth + 1);
    expect(b.left, `«${b.testo}» fuori a sinistra`).toBeGreaterThanOrEqual(-1);
  }
  expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth + 1);
});

test('#497 — un messaggio d\'esito lungo non manda a capo i tasti', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(1280, 800);
  });
  const page = await openTab(URL);
  await pronta(page);
  // Il canale rifiuta con un messaggio lungo: l'esito compare sotto la riga.
  await page.evaluate(() => {
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        return { ok: false, error: 'La scrittura è stata rifiutata dal server di sicurezza perché la chiave della sessione è scaduta: rifai l\'accesso e riprova, il resto della segnalazione non è stato toccato.' };
      }
      return { ok: true };
    };
  });
  await apri(page, { ...BASE, status: 'todo', reviewDecision: 'accepted' }, 'queue');
  await page.locator('#mgActionsRow button', { hasText: 'Risolto' }).click();
  await expect(page.locator('#mgActionMsg')).toContainText('rifiutata');
  unaRigaSola(await tasti(page), 'con messaggio d\'errore lungo');
});

test('#497 — la frase scritta parte anche premendo un tasto di stato (tutte le azioni)', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);

  const porte = [
    { nome: 'Risolto',          tab: 'queue',    fb: { status: 'todo', reviewDecision: 'accepted' }, bottone: 'Risolto' },
    { nome: 'Archivia',         tab: 'queue',    fb: { status: 'todo', reviewDecision: 'accepted' }, bottone: 'Archivia' },
    { nome: 'In coda',          tab: 'inbox',    fb: { status: 'new' },                             bottone: 'In coda' },
    { nome: 'Conferma attacco', tab: 'inbox',    fb: { status: 'suspicious_file' },                 bottone: 'Conferma attacco' },
    { nome: 'Conferma spam',    tab: 'inbox',    fb: { status: 'suspicious_file' },                 bottone: 'Conferma spam' },
    { nome: 'Ripristina',       tab: 'archived', fb: { status: 'archived' },                        bottone: 'Ripristina' },
  ];

  for (const p of porte) {
    const id = `v497-porta-${p.nome}`;
    await page.evaluate(() => { window.__updates = []; });
    await apri(page, { ...BASE, ...p.fb, _id: id }, p.tab);
    await page.locator('#mgUserNoteToggle').click();
    await page.locator('#mgUserNoteText').fill(`Frase per ${p.nome}`);
    await page.locator('#mgActionsRow button', { hasText: p.bottone }).click();
    await expect.poll(() => page.evaluate(() => window.__updates.length), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    const inviati = await page.evaluate(() => window.__updates);
    const frase = inviati.find((u) => typeof u.userNote === 'string');
    const stato = inviati.find((u) => typeof u.status === 'string');
    expect(frase, `${p.nome}: la frase non è partita`).toBeTruthy();
    expect(frase.userNote).toBe(`Frase per ${p.nome}`);
    expect(frase.id).toBe(id);
    expect(stato, `${p.nome}: lo stato non è cambiato`).toBeTruthy();
    // La frase deve partire PRIMA del cambio di stato.
    expect(inviati.indexOf(frase), `${p.nome}: frase dopo lo stato`).toBeLessThan(inviati.indexOf(stato));
  }
});

test('#497 — la frase non si perde ricliccando la stessa segnalazione né cambiando sezione', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  const fb = { ...BASE, status: 'todo', reviewDecision: 'accepted', _id: 'v497-clic' };
  await apri(page, fb, 'queue');

  // Porta 1: riclicco la stessa segnalazione nella lista.
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Riga scritta e mai salvata a mano.');
  await page.locator(`.mg-item[data-id="${fb._id}"]`).click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__updates[0].userNote)).toBe('Riga scritta e mai salvata a mano.');
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNoteText')).toHaveValue('Riga scritta e mai salvata a mano.');

  // Porta 2: cambio sezione e rientro.
  await page.evaluate(() => { window.__updates = []; });
  await page.locator('#mgUserNoteText').fill('Seconda riga, cambiando sezione.');
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__updates[0].userNote)).toBe('Seconda riga, cambiando sezione.');

  // Porta 3: chiudo la sezione col tasto senza salvare a mano.
  await page.evaluate(() => { window.__updates = []; });
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Terza riga, poi richiudo la sezione.');
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNote')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__updates[0].userNote)).toBe('Terza riga, poi richiudo la sezione.');
});

test('#497 — se la frase non si salva, lo stato non cambia e la sezione si riapre', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate(() => {
    window.__updates = [];
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        if (typeof msg.userNote === 'string') return { ok: false, error: 'rete giù' };
        return { ok: true };
      }
      return { ok: true };
    };
  });
  await apri(page, { ...BASE, status: 'todo', reviewDecision: 'accepted', _id: 'v497-ko' }, 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Questa non arriverà.');
  await page.locator('#mgUserNoteToggle').click();       // richiudo: il salvataggio parte e fallisce
  await expect(page.locator('#mgUserNote')).toBeVisible(); // si riapre da sola per mostrare l'errore
  await page.locator('#mgActionsRow button', { hasText: 'Risolto' }).click();
  await expect(page.locator('#mgActionMsg')).toContainText('non si è salvata');
  const stati = await page.evaluate(() => window.__updates.filter((u) => typeof u.status === 'string'));
  expect(stati.length, 'lo stato è cambiato lo stesso').toBe(0);
  // Il testo dell\'owner è ancora lì: non è stato buttato via.
  await expect(page.locator('#mgUserNoteText')).toHaveValue('Questa non arriverà.');
});

test('#497 — un aggiornamento remoto non chiude la sezione aperta', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  const fb = { ...BASE, status: 'todo', reviewDecision: 'accepted', _id: 'v497-live' };
  await apri(page, fb, 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await expect(page.locator('#mgUserNote')).toBeVisible();
  await page.evaluate((id) => window.__mgTest.rerenderIfIdle(id), fb._id);
  await expect(page.locator('#mgUserNote'), 'la sezione si è chiusa in faccia all\'owner').toBeVisible();
});

test('#497 — stress sul tasto: doppio clic, aperture in sequenza, tasti speciali', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, status: 'todo', reviewDecision: 'accepted', _id: 'v497-stress' }, 'queue');
  const toggle = page.locator('#mgUserNoteToggle');

  await toggle.dblclick();
  let stato = await page.evaluate(() => ({
    aperta: !document.getElementById('mgUserNote').hidden,
    aria: document.getElementById('mgUserNoteToggle').getAttribute('aria-expanded'),
  }));
  expect(String(stato.aperta)).toBe(stato.aria);

  for (let i = 0; i < 6; i++) await toggle.click();
  stato = await page.evaluate(() => ({
    aperta: !document.getElementById('mgUserNote').hidden,
    aria: document.getElementById('mgUserNoteToggle').getAttribute('aria-expanded'),
  }));
  expect(String(stato.aperta)).toBe(stato.aria);

  // Aperta, il cursore è dentro la casella: chi preme quel tasto vuole scrivere.
  if (!stato.aperta) await toggle.click();
  await expect(page.locator('#mgUserNoteText')).toBeFocused();

  // HTML e script restano testo.
  await page.evaluate(() => { window.__updates = []; });
  await page.locator('#mgUserNoteText').fill('<img src=x onerror=alert(1)><script>alert(2)</script> ok');
  await page.locator('#mgUserNoteBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const html = await page.locator('#mgThread').innerHTML();
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  const testo = await page.locator('#mgThread').innerText();
  expect(testo).toContain('alert(1)');
  expect(await page.evaluate(() => document.querySelectorAll('#mgThread img, #mgThread script').length)).toBe(0);
});

test('#497 — 10.000 caratteri incollati nella casella', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, status: 'todo', reviewDecision: 'accepted', _id: 'v497-lungo' }, 'queue');
  await page.locator('#mgUserNoteToggle').click();
  const lungo = 'a'.repeat(10000);
  // Inserito come lo inserirebbe un utente (rispetta maxlength del campo).
  await page.locator('#mgUserNoteText').click();
  await page.keyboard.insertText(lungo);
  await page.waitForTimeout(300);
  const dopoIncolla = await page.locator('#mgUserNoteText').inputValue();
  console.log('INCOLLA 10k → caratteri rimasti:', dopoIncolla.length);
  // E per via programmatica (nessun limite del campo): cosa parte davvero?
  await page.evaluate(() => { window.__updates = []; });
  await page.locator('#mgUserNoteText').fill(lungo);
  await page.locator('#mgUserNoteBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const inviata = await page.evaluate(() => window.__updates[0].userNote);
  console.log('SALVATAGGIO da 10k → caratteri spediti:', inviata.length,
    '| avviso mostrato:', await page.locator('#mgUserNoteMsg').innerText());
  expect(inviata.length).toBeLessThanOrEqual(500);
});

test('#497 — la frase esiste ma è chiusa: si vede da qualche parte?', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, status: 'done', statusPublic: 'closed', userNote: 'Ora il tasto risponde.', _id: 'v497-vista' }, 'resolved');
  await expect(page.locator('#mgUserNote')).toBeHidden();
  const dettaglio = await page.locator('#mgDetail').innerText();
  console.log('FRASE VISIBILE NEL DETTAGLIO?', dettaglio.includes('Ora il tasto risponde.'));
  expect(dettaglio).toContain('Ora il tasto risponde.');
});

test('#497 — schermata: tema chiaro e tema scuro', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(1280, 800);
  });
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, status: 'suspicious_file', userNote: 'Ora funziona.', _id: 'v497-shot' }, 'inbox');
  await page.screenshot({ path: 'tests/.shots/497-giro2-chiuso.png' });
  await page.locator('#mgUserNoteToggle').click();
  await page.screenshot({ path: 'tests/.shots/497-giro2-aperto.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/497-giro2-scuro.png' });
});

// #509 — GIRO 5 di verifica (avversariale). Le due superfici che elencano le
// segnalazioni — filo://feedback e la dashboard di gestione filo://manage —
// devono dire la stessa cosa sulla stessa coda.
//
// I giri passati hanno chiuso quattro famiglie di porte:
//   giro 1 → il secondo clic cadeva su un'ALTRA segnalazione;
//   giro 2 → sul computer senza chiave la gemella inventava "In coda (0)";
//   giro 3 → sulla stessa segnalazione le due pagine offrivano azioni diverse,
//            e «Archivia» su un attacco confermato cancellava la conferma;
//   giro 4 → in una coda MISTA (una segnalazione illeggibile in mezzo a tante
//            leggibili) la dashboard tornava a dire cose che non sa: la bolla
//            del parere, il bordo bianco dei "non filtrati", e il mucchio da
//            rimandare ai giudici.
// Qui si ri-provano tutte, e si cerca la porta successiva.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const VERSIONE = '1.0.0';

const CIFRATO = 'FENCv1:AAAABBBBCCCCDDDD==';

// ── Coda MISTA: illeggibili in mezzo a leggibili ───────────────────────────
// È il caso del giro 4: la barra delle sezioni resta (la lista NON è tutta
// illeggibile), e su ogni singola segnalazione cifrata la pagina non deve
// affermare niente che non sa.
const MISTA = [
  // leggibili
  { _id: 'r_unlab',   seq: 1,  status: 'unlabeled',    name: 'non filtrato vero' },
  { _id: 'r_aligned', seq: 2,  status: 'aligned',      name: 'allineato vero' },
  { _id: 'r_attack',  seq: 3,  status: 'attack',       name: 'attacco' },
  { _id: 'r_todo',    seq: 4,  status: 'todo',         name: 'in coda' },
  { _id: 'r_done',    seq: 5,  status: 'done', resolvedInVersion: '0.9.0', name: 'chiuso e uscito' },
  { _id: 'r_arch',    seq: 6,  status: 'archived',     name: 'archiviato' },
  { _id: 'r_atkconf', seq: 7,  status: 'attack_confirmed', name: 'attacco confermato' },
  // illeggibili, con i tre valori possibili dell'enum grossolano in chiaro
  { _id: 'k_closed',  seq: 8,  status: CIFRATO, statusPublic: 'closed', name: 'cifrata chiusa' },
  { _id: 'k_open',    seq: 9,  status: CIFRATO, statusPublic: 'open',   name: 'cifrata aperta' },
  { _id: 'k_muta',    seq: 10, status: CIFRATO,                          name: 'cifrata muta' },
  // illeggibile CON verdetti dei giudici in pipeline: i pallini avrebbero di
  // che disegnarsi, ma lo stato resta quello che non si legge.
  { _id: 'k_giudici', seq: 11, status: CIFRATO, statusPublic: 'closed', name: 'cifrata giudicata',
    pipeline: { verdicts: [{ class: 'aligned' }, { class: 'aligned' }, { class: 'aligned' }, { class: 'aligned' }] } },
  // illeggibile con anche revisione e note cifrate
  { _id: 'k_tutto',   seq: 12, status: CIFRATO, statusPublic: 'open', name: 'cifrata integrale',
    reviewDecision: CIFRATO, reviewComment: CIFRATO, reviewedAt: CIFRATO, notes: CIFRATO },
  // illeggibile con statusPublic storto (non è né open né closed)
  { _id: 'k_storto',  seq: 13, status: CIFRATO, statusPublic: 'boh', name: 'cifrata con enum storto' },
].map((f) => Object.assign({
  text: `Testo di ${f._id}, della stessa lunghezza degli altri.`,
  createdAt: '2026-08-01T10:00:00Z',
  clientId: 'tester',
}, f));

const CIFRATE = MISTA.filter((f) => String(f.status).startsWith('FENC')).map((f) => f._id);
const TABS = ['inbox', 'queue', 'resolved', 'archived'];

// ── Aperture ───────────────────────────────────────────────────────────────
async function apriFeedback(openTab, coda, { admin = true } = {}) {
  const p = await openTab(FEEDBACK);
  await p.waitForLoadState('domcontentloaded');
  await p.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW, null, { timeout: 20_000 });
  await p.evaluate(({ list, adm, v }) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && (msg.type === 'feedback_update' || msg.type === 'feedback_reevaluate')) {
        window.__updates.push(msg);
        return { ok: true, results: [{ ok: true, recovered: 0, attempted: 0 }] };
      }
      return orig(msg);
    };
    window.__fbTest.setAdmin(adm, adm ? { email: 'owner@example.com' } : null);
    window.__fbTest.setData(list);
    window.__fbTest.setReleasedVersion(v);
  }, { list: coda, adm: admin, v: VERSIONE });
  return p;
}

async function apriManage(openTab, coda, { admin = true } = {}) {
  const p = await openTab(MANAGE);
  await p.waitForLoadState('domcontentloaded');
  await p.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady, null, { timeout: 20_000 });
  await p.evaluate(() => window.__mgTest.whenReady());
  await p.evaluate(({ list, adm, v }) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && (msg.type === 'feedback_update' || msg.type === 'feedback_reevaluate')) {
        window.__updates.push(msg);
        return { ok: true, results: [{ ok: true, recovered: 0, attempted: 0 }] };
      }
      return orig(msg);
    };
    window.__mgTest.setAdmin(adm);
    window.__mgTest.setData(list);
    window.__mgTest.setReleasedVersion(v);
  }, { list: coda, adm: admin, v: VERSIONE });
  return p;
}

const barraFb = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#tabs [data-tab]'))
  .filter((el) => !el.hidden && el.offsetParent !== null)
  .map((el) => el.innerText.trim().replace(/\s+/g, ' ')));
const barraMg = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#mgTabs .mg-tab'))
  .filter((el) => !el.hidden && ['inbox', 'queue', 'resolved', 'archived'].includes(el.dataset.tab))
  .map((el) => el.innerText.trim().replace(/\s+/g, ' ')));

async function contenutoFb(p, tab) {
  await p.evaluate((t) => window.__fbTest.setTab(t), tab);
  return p.evaluate(() => Array.from(document.querySelectorAll('.fb-card')).map((c) => c.dataset.id));
}
async function contenutoMg(p, tab) {
  await p.evaluate((t) => window.__mgTest.setTab(t), tab);
  return p.evaluate(() => Array.from(document.querySelectorAll('#mgList .mg-item')).map((c) => c.dataset.id));
}

// La scheda di UNA segnalazione, su ciascuna pagina: cosa dice e come si veste.
async function schedaFb(p, id) {
  for (const t of TABS) {
    await p.evaluate((tt) => window.__fbTest.setTab(tt), t);
    const r = await p.evaluate((fid) => {
      const card = document.querySelector(`.fb-card[data-id="${CSS.escape(fid)}"]`);
      if (!card) return null;
      const st = card.querySelector('.fb-state');
      return {
        stato: st ? st.innerText.trim().replace(/\s+/g, ' ') : '',
        azioni: Array.from(card.querySelectorAll('.fb-actions button')).map((b) => b.textContent.trim()),
      };
    }, id);
    if (r) return { ...r, tab: t };
  }
  return null;
}
async function schedaMg(p, id) {
  for (const t of TABS) {
    await p.evaluate((tt) => window.__mgTest.setTab(tt), t);
    const r = await p.evaluate((fid) => {
      const it = document.querySelector(`#mgList .mg-item[data-id="${CSS.escape(fid)}"]`);
      if (!it) return null;
      const st = it.querySelector('.mg-state');
      return {
        stato: st ? st.innerText.trim().replace(/\s+/g, ' ') : '',
        bianco: it.classList.contains('mg-item--unfiltered'),
        blu: it.classList.contains('mg-item--aligned'),
      };
    }, id);
    if (r) return { ...r, tab: t };
  }
  return null;
}
async function azioniMg(p, id) {
  await p.evaluate((fid) => window.__mgTest.openDetail(fid), id);
  return p.evaluate(() => {
    const box = document.getElementById('mgActions');
    const row = document.getElementById('mgActionsRow');
    if (!row || (box && box.hidden)) return [];
    return Array.from(row.querySelectorAll('button')).map((b) => b.textContent.trim());
  });
}

// ───────────────────────────────────────────────────────────────────────────
test('#509/g5 — coda mista: barra, numeri e contenuto identici sulle due pagine', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, MISTA);
  const mg = await apriManage(openTab, MISTA);

  const bf = await barraFb(fb);
  expect(bf.length, 'la barra delle sezioni resta: la lista NON è tutta illeggibile').toBe(4);
  expect(await barraMg(mg), 'la barra delle sezioni').toEqual(bf);

  for (const tab of TABS) {
    const a = (await contenutoFb(fb, tab)).slice().sort();
    const b = (await contenutoMg(mg, tab)).slice().sort();
    expect(b, `contenuto della sezione "${tab}"`).toEqual(a);
  }

  const tutti = [];
  for (const tab of TABS) tutti.push(...await contenutoFb(fb, tab));
  expect(tutti.slice().sort(), 'nessuna segnalazione sparita o contata due volte')
    .toEqual(MISTA.map((f) => f._id).slice().sort());
});

test('#509/g5 — in coda mista la scheda cifrata dice la stessa cosa sulle due pagine', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, MISTA);
  const mg = await apriManage(openTab, MISTA);

  const diff = [];
  for (const id of CIFRATE) {
    const a = await schedaFb(fb, id);
    const b = await schedaMg(mg, id);
    if (!a || !b) { diff.push({ id, feedback: a, gestione: b, nota: 'scheda assente' }); continue; }
    // 1. le stesse parole (Aperta/Chiusa, o niente quando non si sa).
    if (a.stato !== b.stato) diff.push({ id, nota: 'stato pubblico diverso', feedback: a.stato, gestione: b.stato });
    // 2. la stessa sezione.
    if (a.tab !== b.tab) diff.push({ id, nota: 'sezione diversa', feedback: a.tab, gestione: b.tab });
    // 3. il bordo NON afferma "non filtrato" né "allineato": sono letture dello stato.
    if (b.bianco) diff.push({ id, nota: 'gestione: bordo bianco "non filtrato" su una cifrata' });
    if (b.blu) diff.push({ id, nota: 'gestione: bordo blu "allineato" su una cifrata' });
    // 4. nessuna azione, su nessuna delle due pagine.
    const azMg = await azioniMg(mg, id);
    if (a.azioni.length || azMg.length) {
      diff.push({ id, nota: 'azioni offerte su una cifrata', feedback: a.azioni, gestione: azMg });
    }
  }
  expect(diff, 'differenze sulle schede cifrate in coda mista').toEqual([]);
});

test('#509/g5 — le due cifrate con enum leggibile dicono davvero Aperta/Chiusa', async ({ openTab }) => {
  const mg = await apriManage(openTab, MISTA);
  expect((await schedaMg(mg, 'k_closed')).stato).toBe('Chiusa');
  expect((await schedaMg(mg, 'k_open')).stato).toBe('Aperta');
  // Quando nemmeno l'enum grossolano si legge, non si inventa niente.
  expect((await schedaMg(mg, 'k_muta')).stato).toBe('');
  expect((await schedaMg(mg, 'k_storto')).stato).toBe('');
});

test('#509/g5 — il dettaglio di una cifrata non dichiara giudizi che non ha', async ({ openTab }) => {
  const mg = await apriManage(openTab, MISTA);
  for (const id of CIFRATE) {
    await mg.evaluate((fid) => window.__mgTest.openDetail(fid), id);
    const d = await mg.evaluate(() => ({
      thread: document.getElementById('mgThread').innerText,
      giudici: (() => { const r = document.getElementById('mgJudgesRow'); return r && !r.hidden ? r.innerText.trim() : ''; })(),
      statoRiga: (() => { const r = document.getElementById('mgDetailState'); return r && !r.hidden ? r.innerText.trim() : ''; })(),
    }));
    expect(d.thread, `${id}: la bolla non deve promettere un giudizio in arrivo`)
      .not.toContain('non ha ancora un parere');
    expect(d.giudici, `${id}: la riga dei giudici non deve dire "In attesa del giudizio"`)
      .not.toContain('In attesa del giudizio');
    expect(d.thread, `${id}: nessun blob cifrato mostrato come testo`).not.toContain('FENCv1');
    expect(d.statoRiga, `${id}: nessuna etichetta di stato inventata`).not.toContain('Non filtrato');
  }
});

test('#509/g5 — le barre in cima ai Ricevuti non raccolgono le cifrate', async ({ openTab }) => {
  const mg = await apriManage(openTab, MISTA);
  await mg.evaluate(() => window.__mgTest.setTab('inbox'));

  const barre = await mg.evaluate(() => ({
    reeval: (() => { const b = document.getElementById('mgReevalBar'); return b && !b.hidden ? document.getElementById('mgReevalBtn').textContent.trim() : ''; })(),
    aligned: (() => { const b = document.getElementById('mgAlignedBar'); return b && !b.hidden ? document.getElementById('mgAlignedBtn').textContent.trim() : ''; })(),
  }));
  // Nella coda mista c'è UN solo non-filtrato vero e UN solo allineato vero.
  expect(barre.reeval, 'il mucchio da rimandare ai giudici').toContain('(1)');
  expect(barre.aligned, 'il mucchio da approvare in blocco').toContain('(1)');

  // E premendoli si scrive solo su quelli, mai su una cifrata.
  await mg.evaluate(() => { window.__updates = []; document.getElementById('mgReevalBtn').click(); });
  await mg.waitForTimeout(800);
  let u = await mg.evaluate(() => window.__updates);
  const toccati = u.flatMap((x) => x.feedbackIds || [x.id]).filter(Boolean);
  expect(toccati.filter((id) => CIFRATE.includes(id)), 'cifrate rimandate ai giudici').toEqual([]);
  expect(toccati).toEqual(['r_unlab']);

  await mg.evaluate(() => { window.__updates = []; document.getElementById('mgAlignedBtn').click(); });
  await mg.waitForTimeout(800);
  u = await mg.evaluate(() => window.__updates);
  const scritti = u.map((x) => x.id).filter(Boolean);
  expect(scritti.filter((id) => CIFRATE.includes(id)), 'cifrate approvate in blocco').toEqual([]);
  expect(scritti).toEqual(['r_aligned']);
});

test('#509/g5 — da illeggibile a leggibile e ritorno: nessun numero appiccicato', async ({ openTab }) => {
  const tutteCifrate = MISTA.map((f) => ({ ...f, status: CIFRATO }));
  const mg = await apriManage(openTab, tutteCifrate);
  const fb = await apriFeedback(openTab, tutteCifrate);

  // Senza chiave: niente sezioni, su tutt'e due, con le stesse parole.
  expect(await barraMg(mg)).toEqual([]);
  expect(await barraFb(fb)).toEqual([]);
  const avvisoMg = await mg.evaluate(() => document.getElementById('mgNoSections').textContent.trim());
  const avvisoFb = await fb.evaluate(() => document.getElementById('noSections').textContent.trim());
  expect(avvisoMg, 'la riga che spiega perché le sezioni non ci sono').toBe(avvisoFb);
  expect(avvisoMg.length).toBeGreaterThan(10);

  // Arriva la chiave: le sezioni tornano, coi numeri veri.
  await mg.evaluate((l) => window.__mgTest.setData(l), MISTA);
  await fb.evaluate((l) => window.__fbTest.setData(l), MISTA);
  const dopo = await barraMg(mg);
  expect(dopo.length).toBe(4);
  expect(await barraFb(fb)).toEqual(dopo);

  // E si torna indietro: nessun "(3) (0) (0) (0)" rimasto appiccicato.
  await mg.evaluate((l) => window.__mgTest.setData(l), tutteCifrate);
  await fb.evaluate((l) => window.__fbTest.setData(l), tutteCifrate);
  expect(await barraMg(mg)).toEqual([]);
  expect(await barraFb(fb)).toEqual([]);
  const testaMg = await mg.evaluate(() => document.getElementById('mgListHead').textContent.trim());
  expect(testaMg, 'la colonna non porta il nome di una sezione che non è stata scelta')
    .not.toMatch(/Ricevuti|In coda|Risolti|Archiviati/);
});

test('#509/g5 — senza chiave nessuna decisione, e i mucchi in cima non compaiono', async ({ openTab }) => {
  const tutteCifrate = MISTA.map((f) => ({ ...f, status: CIFRATO }));
  const mg = await apriManage(openTab, tutteCifrate);
  const fb = await apriFeedback(openTab, tutteCifrate);

  const barre = await mg.evaluate(() => ({
    reeval: !document.getElementById('mgReevalBar').hidden,
    aligned: !document.getElementById('mgAlignedBar').hidden,
  }));
  expect(barre.reeval, 'il mucchio da rimandare ai giudici, senza saper leggere').toBe(false);
  expect(barre.aligned, 'l\'approvazione in blocco, senza saper leggere').toBe(false);

  for (const id of ['k_closed', 'r_todo', 'r_atkconf']) {
    expect(await azioniMg(mg, id), `gestione: azioni su ${id} senza chiave`).toEqual([]);
    const s = await schedaFb(fb, id);
    expect(s && s.azioni, `feedback: azioni su ${id} senza chiave`).toEqual([]);
  }
});

test('#509/g5 — un pannello rimasto aperto non scrive una decisione che non è più offerta', async ({ openTab }) => {
  const mg = await apriManage(openTab, MISTA);
  // Apri l'archiviato: l'unica azione è il ripristino.
  await mg.evaluate(() => window.__mgTest.setTab('archived'));
  expect(await azioniMg(mg, 'r_arch')).toEqual(['↩ Ripristina']);

  // Sotto le mani lo stato diventa illeggibile (arriva un aggiornamento).
  await mg.evaluate((l) => window.__mgTest.setData(l), MISTA.map((f) =>
    (f._id === 'r_arch' ? { ...f, status: CIFRATO, statusPublic: 'closed' } : f)));
  await mg.evaluate(() => { window.__updates = []; });
  // Il pulsante è ancora a schermo (il pannello non si ridisegna da solo):
  // premerlo NON deve scrivere.
  await mg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#mgActionsRow button'))
      .find((x) => x.textContent.includes('Ripristina'));
    if (b) b.click();
  });
  await mg.waitForTimeout(400);
  expect(await mg.evaluate(() => window.__updates), 'scritture su uno stato non più leggibile').toEqual([]);
});

test('#509/g5 — porte del giro 1: tre clic fermi scrivono una volta sola (coda mista)', async ({ openTab }) => {
  const porte = [
    { tab: 'inbox',    sel: '.fb-act[data-id="r_unlab"][data-to="todo"]', id: 'r_unlab', to: 'todo' },
    { tab: 'queue',    sel: '.fb-act[data-id="r_todo"][data-to="done"]',  id: 'r_todo',  to: 'done' },
    { tab: 'archived', sel: '.fb-act[data-id="r_arch"][data-to="todo"]',  id: 'r_arch',  to: 'todo' },
  ];
  const p = await apriFeedback(openTab, MISTA);
  for (const porta of porte) {
    await p.evaluate((l) => { window.__updates = []; window.__fbTest.setData(l); }, MISTA);
    await p.evaluate((t) => window.__fbTest.setTab(t), porta.tab);
    await p.locator(porta.sel).scrollIntoViewIfNeeded();
    const box = await p.locator(porta.sel).boundingBox();
    expect(box, `il pulsante ${porta.sel} deve essere a schermo`).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForTimeout(400);
    }
    const u = await p.evaluate(() => window.__updates);
    expect(u.length, `scritture dopo tre clic su ${porta.sel}`).toBe(1);
    expect(u[0].id).toBe(porta.id);
    expect(u[0].status).toBe(porta.to);
    expect(u.some((x) => String(x.status).endsWith('_confirmed')),
      'nessuna conferma di attacco/spam presa per sbaglio').toBe(false);
  }
});

test('#509/g5 — non-owner: le due pagine tacciono allo stesso modo', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, MISTA, { admin: false });
  const mg = await apriManage(openTab, MISTA, { admin: false });

  // Le sezioni si vedono (gli stati si leggono), ma nessuna decisione è offerta.
  expect(await barraMg(mg)).toEqual(await barraFb(fb));
  for (const id of ['r_unlab', 'r_todo', 'r_arch', 'k_closed']) {
    const s = await schedaFb(fb, id);
    expect(s && s.azioni, `feedback non-owner: azioni su ${id}`).toEqual([]);
    expect(await azioniMg(mg, id), `gestione non-owner: azioni su ${id}`).toEqual([]);
  }
  const barre = await mg.evaluate(() => ({
    reeval: !document.getElementById('mgReevalBar').hidden,
    aligned: !document.getElementById('mgAlignedBar').hidden,
  }));
  expect(barre.reeval || barre.aligned, 'i mucchi in cima sono roba da owner').toBe(false);
});

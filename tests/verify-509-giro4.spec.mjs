// #509 — GIRO 4 di verifica (avversariale). Le due superfici che elencano i
// feedback — filo://feedback e la dashboard di gestione filo://manage — devono
// dire la stessa cosa sulla stessa coda: stesse sezioni, stessi numeri, stesso
// contenuto, stesse azioni, stessa scrittura.
//
// I giri passati hanno chiuso tre famiglie di porte:
//   giro 1 → il secondo clic cadeva su un'ALTRA segnalazione;
//   giro 2 → sul computer senza chiave la gemella inventava "In coda (0)";
//   giro 3 → sulla stessa segnalazione le due pagine offrivano azioni diverse,
//            e «Archivia» su un attacco confermato cancellava la conferma.
// Qui si ri-provano TUTTE, con una coda molto più storta, e si cerca la porta
// successiva: la parità viene misurata segnalazione per segnalazione, non su
// un campione.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const VERSIONE = '1.0.0';

// ── La coda storta ─────────────────────────────────────────────────────────
// Ogni stato canonico, ogni stato legacy, e la spazzatura: mancante, vuoto,
// nullo, numerico, inventato, lunghissimo, con HTML dentro.
const CODA = [
  { _id: 'c_unlabeled', seq: 1,  status: 'unlabeled',           name: 'non filtrato' },
  { _id: 'c_suspfile',  seq: 2,  status: 'suspicious_file',     name: 'file sospetto' },
  { _id: 'c_attack',    seq: 3,  status: 'attack',              name: 'attacco' },
  { _id: 'c_spam',      seq: 4,  status: 'spam',                name: 'spam' },
  { _id: 'c_design',    seq: 5,  status: 'design',              name: 'design' },
  { _id: 'c_loop',      seq: 6,  status: 'design', statusReason: 'loop',     name: 'loop' },
  { _id: 'c_secaudit',  seq: 7,  status: 'design', statusReason: 'secaudit', name: 'bocciato sicurezza' },
  { _id: 'c_clarify',   seq: 8,  status: 'design', statusReason: 'clarify',  name: 'chiarimenti' },
  { _id: 'c_aligned',   seq: 9,  status: 'aligned',             name: 'allineato' },
  { _id: 'c_todo',      seq: 10, status: 'todo',                name: 'in coda' },
  { _id: 'c_working',   seq: 11, status: 'working',             name: 'in lavorazione' },
  { _id: 'c_revcap',    seq: 12, status: 'revision_capability', name: 'verifica fix' },
  { _id: 'c_revsec',    seq: 13, status: 'revision_security',   name: 'audit sicurezza' },
  { _id: 'c_done_no',   seq: 14, status: 'done', resolvedInVersion: '9.9.9', name: 'chiuso non uscito' },
  { _id: 'c_done_si',   seq: 15, status: 'done', resolvedInVersion: '0.9.0', name: 'chiuso e uscito' },
  { _id: 'c_archived',  seq: 16, status: 'archived',            name: 'archiviato' },
  { _id: 'c_atkconf',   seq: 17, status: 'attack_confirmed',    name: 'attacco confermato' },
  { _id: 'c_spamconf',  seq: 18, status: 'spam_confirmed',      name: 'spam confermato' },
  // legacy
  { _id: 'l_new',       seq: 19, status: 'new',      name: 'legacy nuovo' },
  { _id: 'l_draft',     seq: 20, status: 'draft',    name: 'legacy bozza' },
  { _id: 'l_review',    seq: 21, status: 'review',   name: 'legacy in revisione' },
  { _id: 'l_clarify',   seq: 22, status: 'clarify',  name: 'legacy chiarimenti' },
  { _id: 'l_blocked',   seq: 23, status: 'blocked',  name: 'legacy bloccato' },
  { _id: 'l_verified',  seq: 24, status: 'verified', name: 'legacy verificato' },
  { _id: 'l_ignored',   seq: 25, status: 'ignored',  name: 'legacy ignorato' },
  // spazzatura
  { _id: 'x_missing',   seq: 26,                     name: 'stato mancante' },
  { _id: 'x_empty',     seq: 27, status: '',         name: 'stato vuoto' },
  { _id: 'x_null',      seq: 28, status: null,       name: 'stato nullo' },
  { _id: 'x_num',       seq: 29, status: 7,          name: 'stato numerico' },
  { _id: 'x_fake',      seq: 30, status: 'inventato', name: 'stato inventato' },
  { _id: 'x_long',      seq: 31, status: 'a'.repeat(10000), name: 'stato lunghissimo' },
  { _id: 'x_html',      seq: 32, status: '<script>alert(1)</script>', name: 'stato con html' },
  // allineato con un giudice che ha visto un attacco (escalation conservativa)
  { _id: 'e_aligned_atk', seq: 33, status: 'aligned', name: 'allineato ma segnalato',
    pipeline: { verdicts: [{ class: 'attack' }, { class: 'safe' }] } },
  // preferito, priorità fuori scala, data illeggibile
  { _id: 'z_starred',   seq: 34, status: 'todo', starred: true, priority: 99,
    createdAt: 'non-una-data', name: 'preferito storto' },
].map((f) => Object.assign({
  text: `Testo di ${f._id}, lungo uguale agli altri per tenere le schede della stessa altezza.`,
  createdAt: '2026-08-01T10:00:00Z',
  clientId: 'tester',
}, f));

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
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
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
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(adm);
    window.__mgTest.setData(list);
    window.__mgTest.setReleasedVersion(v);
  }, { list: coda, adm: admin, v: VERSIONE });
  return p;
}

// Etichette delle sezioni come si leggono nella barra.
const barraFb = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#tabs [data-tab]'))
  .filter((el) => !el.hidden && el.offsetParent !== null)
  .map((el) => el.innerText.trim().replace(/\s+/g, ' ')));
const barraMg = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#mgTabs .mg-tab'))
  .filter((el) => !el.hidden && ['inbox', 'queue', 'resolved', 'archived'].includes(el.dataset.tab))
  .map((el) => el.innerText.trim().replace(/\s+/g, ' ')));

// Gli id contenuti in una sezione, su ciascuna pagina.
async function contenutoFb(p, tab) {
  await p.evaluate((t) => window.__fbTest.setTab(t), tab);
  return p.evaluate(() => Array.from(document.querySelectorAll('.fb-card')).map((c) => c.dataset.id));
}
async function contenutoMg(p, tab) {
  await p.evaluate((t) => window.__mgTest.setTab(t), tab);
  return p.evaluate(() => Array.from(document.querySelectorAll('#mgList .mg-item')).map((c) => c.dataset.id));
}

// Le azioni offerte su UNA segnalazione, su ciascuna pagina.
async function azioniFb(p, id) {
  return p.evaluate((fid) => {
    const card = document.querySelector(`.fb-card[data-id="${CSS.escape(fid)}"]`);
    if (!card) return null;
    return Array.from(card.querySelectorAll('.fb-actions button')).map((b) => b.textContent.trim());
  }, id);
}
async function azioniMg(p, id) {
  await p.evaluate((fid) => window.__mgTest.openDetail(fid), id);
  return p.evaluate(() => {
    const row = document.getElementById('mgActionsRow');
    const box = document.getElementById('mgActions');
    if (!row || (box && box.hidden)) return [];
    return Array.from(row.querySelectorAll('button')).map((b) => b.textContent.trim());
  });
}

// ───────────────────────────────────────────────────────────────────────────
test('#509/g4 — stessa coda storta: stesse sezioni, stessi numeri, stesso contenuto', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA);
  const mg = await apriManage(openTab, CODA);

  expect(await barraMg(mg), 'la barra delle sezioni').toEqual(await barraFb(fb));

  for (const tab of TABS) {
    const a = (await contenutoFb(fb, tab)).slice().sort();
    const b = (await contenutoMg(mg, tab)).slice().sort();
    expect(b, `contenuto della sezione "${tab}"`).toEqual(a);
  }

  // Nessuna segnalazione sparita o contata due volte.
  const tutti = [];
  for (const tab of TABS) tutti.push(...await contenutoFb(fb, tab));
  expect(tutti.slice().sort()).toEqual(CODA.map((f) => f._id).slice().sort());
});

test('#509/g4 — stessa segnalazione, stesse azioni: tutte e 34, non un campione', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA);
  const mg = await apriManage(openTab, CODA);

  const diff = [];
  for (const item of CODA) {
    const id = item._id;
    // la scheda vive nella sua sezione: portacisi.
    const tab = await fb.evaluate((fid) => {
      const f = window.__fbTest && null;
      return window.SN_MANAGE_REVIEW.manageTabFor(
        (window.__codaTest || []).find((x) => x._id === fid) || {}, { releasedVersion: '1.0.0' });
    }, id).catch(() => null);
    let a = null;
    for (const t of TABS) {
      await fb.evaluate((tt) => window.__fbTest.setTab(tt), t);
      a = await azioniFb(fb, id);
      if (a) break;
    }
    const b = await azioniMg(mg, id);
    if (JSON.stringify(a) !== JSON.stringify(b)) diff.push({ id, feedback: a, gestione: b, tab });
  }
  expect(diff, 'segnalazioni su cui le due pagine offrono azioni diverse').toEqual([]);
});

// Rimette la pagina allo stato di partenza (dati freschi, contatore azzerato):
// la fixture apre una window per URL, quindi si riusa la stessa.
const reset = (p, hook, coda) => p.evaluate(({ h, list }) => {
  window.__updates = [];
  window[h].setData(list);
}, { h: hook, list: coda });

test('#509/g4 — stessa azione, stessa scrittura: nessuna decisione cancellata', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA);
  const mg = await apriManage(openTab, CODA);
  const diff = [];

  for (const item of CODA) {
    const id = item._id;
    let etichette = null;
    for (const t of TABS) {
      await fb.evaluate((tt) => window.__fbTest.setTab(tt), t);
      const a = await azioniFb(fb, id);
      if (a) { etichette = a; break; }
    }
    if (!etichette || !etichette.length) continue;

    for (const label of etichette) {
      // «Riapri» apre un modulo, non scrive: fuori da questo confronto.
      if (label === 'Riapri') continue;

      await reset(fb, '__fbTest', CODA);
      for (const t of TABS) {
        await fb.evaluate((tt) => window.__fbTest.setTab(tt), t);
        if (await azioniFb(fb, id)) break;
      }
      await fb.evaluate(({ fid, lab }) => {
        const card = document.querySelector(`.fb-card[data-id="${CSS.escape(fid)}"]`);
        const btn = Array.from(card.querySelectorAll('.fb-actions button'))
          .find((b) => b.textContent.trim() === lab);
        btn.click();
      }, { fid: id, lab: label });
      await fb.waitForTimeout(250);
      const wf = await fb.evaluate(() => window.__updates);

      await reset(mg, '__mgTest', CODA);
      await mg.evaluate((fid) => window.__mgTest.openDetail(fid), id);
      await mg.evaluate((lab) => {
        const btn = Array.from(document.querySelectorAll('#mgActionsRow button'))
          .find((b) => b.textContent.trim() === lab);
        btn.click();
      }, label);
      await mg.waitForTimeout(250);
      const wm = await mg.evaluate(() => window.__updates);

      const pulisci = (u) => u.map((x) => {
        const { type, reviewedAt, notes, userNote, reviewComment, ...resto } = x;
        return resto;
      });
      const A = pulisci(wf); const B = pulisci(wm);
      if (JSON.stringify(A) !== JSON.stringify(B)) diff.push({ id, label, feedback: A, gestione: B });
    }
  }
  expect(diff, 'azioni che scrivono cose diverse sulle due pagine').toEqual([]);
});

// ── Le porte del giro 1: un clic, una scheda (ri-prova) ────────────────────
async function clicRipetuti(page, sel, volte = 3, pausa = 400) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  const box = await page.locator(sel).boundingBox();
  expect(box, `il pulsante ${sel} deve essere a schermo`).not.toBeNull();
  const x = box.x + box.width / 2; const y = box.y + box.height / 2;
  for (let i = 0; i < volte; i++) { await page.mouse.click(x, y); await page.waitForTimeout(pausa); }
}

test('#509/g4 — tre clic fermi sullo stesso punto scrivono una volta sola (tutte e tre le porte)', async ({ openTab }) => {
  const porte = [
    { tab: 'inbox',    sel: '.fb-act[data-id="c_unlabeled"][data-to="todo"]', id: 'c_unlabeled', to: 'todo' },
    { tab: 'queue',    sel: '.fb-act[data-id="c_todo"][data-to="done"]',      id: 'c_todo',      to: 'done' },
    { tab: 'archived', sel: '.fb-act[data-id="c_archived"][data-to="todo"]',  id: 'c_archived',  to: 'todo' },
  ];
  const p = await apriFeedback(openTab, CODA);
  for (const porta of porte) {
    await reset(p, '__fbTest', CODA);
    await p.evaluate((t) => window.__fbTest.setTab(t), porta.tab);
    await clicRipetuti(p, porta.sel);
    const u = await p.evaluate(() => window.__updates);
    expect(u.length, `scritture dopo tre clic su ${porta.sel}`).toBe(1);
    expect(u[0].id).toBe(porta.id);
    expect(u[0].status).toBe(porta.to);
    expect(u.some((x) => String(x.status).endsWith('_confirmed')),
      'nessuna conferma di attacco/spam presa per sbaglio').toBe(false);
  }
});

test('#509/g4 — doppio clic secco e clic su un secondo pulsante mentre il primo è in volo', async ({ openTab }) => {
  const p = await apriFeedback(openTab, CODA);
  await p.evaluate((t) => window.__fbTest.setTab(t), 'inbox');
  // Doppio clic secco.
  await p.locator('.fb-act[data-id="c_unlabeled"][data-to="todo"]').dblclick();
  await p.waitForTimeout(400);
  expect((await p.evaluate(() => window.__updates)).length, 'doppio clic secco').toBe(1);

  // «Archivia» premuto subito dopo «→ In coda» sulla STESSA scheda.
  const p2 = p;
  await reset(p2, '__fbTest', CODA);
  await p2.evaluate((t) => window.__fbTest.setTab(t), 'inbox');
  await p2.evaluate(() => {
    const card = document.querySelector('.fb-card[data-id="c_attack"]');
    const btns = Array.from(card.querySelectorAll('.fb-actions button'));
    btns[0].click();
    const arch = btns.find((b) => b.textContent.trim() === 'Archivia');
    if (arch) arch.click();
  });
  await p2.waitForTimeout(500);
  const u2 = await p2.evaluate(() => window.__updates);
  expect(u2.length, 'due pulsanti della stessa scheda premuti a raffica').toBe(1);
});

test('#509/g4 — su Gestione la riga si spegne: due clic, una scrittura', async ({ openTab }) => {
  const m = await apriManage(openTab, CODA);
  await m.evaluate(() => window.__mgTest.openDetail('c_unlabeled'));
  await m.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('#mgActionsRow button'));
    btns[0].click(); btns[0].click();
    const altro = btns[btns.length - 1];
    if (altro && altro !== btns[0]) altro.click();
  });
  await m.waitForTimeout(500);
  expect((await m.evaluate(() => window.__updates)).length, 'scritture su Gestione').toBe(1);
});

// ── La porta del giro 2: il computer senza la chiave ───────────────────────
const CIFRATA = [
  { _id: 'k_open',   seq: 41, status: 'FENC1:aaaaaaaaaaaaaaaa', statusPublic: 'open',   name: 'aperta' },
  { _id: 'k_closed', seq: 42, status: 'FENC1:bbbbbbbbbbbbbbbb', statusPublic: 'closed', name: 'chiusa' },
  { _id: 'k_muta',   seq: 43, status: 'FENC1:cccccccccccccccc', name: 'senza enum' },
].map((f) => Object.assign({ text: 'testo', createdAt: '2026-08-01T10:00:00Z' }, f));

test('#509/g4 — stato illeggibile: le due pagine tacciono allo stesso modo, e non offrono decisioni', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CIFRATA);
  const mg = await apriManage(openTab, CIFRATA);

  expect(await barraFb(fb), 'sezioni sulla pagina dei feedback').toEqual([]);
  expect(await barraMg(mg), 'sezioni su Gestione').toEqual([]);

  // Nessuna azione offerta su ciò che non si legge, su nessuna delle due.
  for (const item of CIFRATA) {
    expect(await azioniFb(fb, item._id) || [], `azioni feedback su ${item._id}`).toEqual([]);
    expect(await azioniMg(mg, item._id), `azioni gestione su ${item._id}`).toEqual([]);
  }

  // Le stesse parole per dire aperta/chiusa.
  const testoFb = await fb.evaluate(() => document.body.innerText);
  const testoMg = await mg.evaluate(() => document.body.innerText);
  for (const parola of ['Aperta', 'Chiusa']) {
    expect(testoFb.includes(parola), `"${parola}" sulla pagina dei feedback`).toBe(true);
    expect(testoMg.includes(parola), `"${parola}" su Gestione`).toBe(true);
  }
  // Nessun numero inventato.
  for (const t of [testoFb, testoMg]) {
    expect(/In coda \(0\)|Risolti \(0\)|Archiviati \(0\)/.test(t)).toBe(false);
  }
  // E nessuna delle due dice che il giudizio deve ancora arrivare su una chiusa.
  await mg.evaluate(() => window.__mgTest.openDetail('k_closed'));
  const det = await mg.evaluate(() => document.body.innerText);
  expect(det.includes('non ha ancora un parere'), 'Gestione su una segnalazione chiusa').toBe(false);
});

// ── Chi non è l'owner ──────────────────────────────────────────────────────
test('#509/g4 — senza i permessi nessuna delle due pagine offre decisioni', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA, { admin: false });
  const mg = await apriManage(openTab, CODA, { admin: false });
  for (const id of ['c_unlabeled', 'c_todo', 'c_archived', 'c_atkconf']) {
    for (const t of TABS) {
      await fb.evaluate((tt) => window.__fbTest.setTab(tt), t);
      const a = await azioniFb(fb, id);
      if (a) { expect(a, `azioni non-owner su ${id}`).toEqual([]); break; }
    }
    expect(await azioniMg(mg, id), `azioni non-owner su Gestione per ${id}`).toEqual([]);
  }
});

// ── Testo ostile ───────────────────────────────────────────────────────────
const OSTILE = [
  { _id: 'h_script', seq: 51, status: 'unlabeled', name: '<img src=x onerror="window.__pwn=1">',
    text: '<script>window.__pwn=1</script><a href="javascript:window.__pwn=1">clic</a>' },
  { _id: 'h_lungo',  seq: 52, status: 'todo', name: 'lungo', text: 'A'.repeat(10000) },
  { _id: 'h_emoji',  seq: 53, status: 'archived', name: '🙈🙉🙊', text: '🧵'.repeat(500) },
  { _id: 'h_vuoto',  seq: 54, status: 'unlabeled', name: '   ', text: '   ' },
].map((f) => Object.assign({ createdAt: '2026-08-01T10:00:00Z' }, f));

test('#509/g4 — testo ostile: niente esecuzione, niente sezione sbagliata', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, OSTILE);
  const mg = await apriManage(openTab, OSTILE);
  for (const tab of TABS) {
    const a = (await contenutoFb(fb, tab)).slice().sort();
    const b = (await contenutoMg(mg, tab)).slice().sort();
    expect(b, `sezione "${tab}" con testo ostile`).toEqual(a);
  }
  expect(await fb.evaluate(() => window.__pwn)).toBeUndefined();
  expect(await mg.evaluate(() => window.__pwn)).toBeUndefined();
});

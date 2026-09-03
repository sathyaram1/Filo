// #509 — verifica avversariale, GIRO 4 (temporanea, del verificatore).
//
// Sintomo: le due pagine (pagina dei feedback / dashboard di gestione)
// chiamano le sezioni con gli stessi nomi ma le riempiono con regole diverse.
// Porte trovate e chiuse nei giri precedenti — TUTTE da ri-provare:
//   giro 1 → il secondo clic nello stesso punto cadeva su un'altra segnalazione;
//   giro 2 → il caso "questo computer non legge gli stati" sistemato su una
//            pagina sola (la gemella inventava «In coda (0) · Risolti (0)…»);
//   giro 3 → sulla STESSA segnalazione le due pagine offrivano AZIONI diverse:
//            archiviato senza ripristino su Gestione, «Archivia» che cancellava
//            una conferma di attacco, una sola conferma sul file sospetto, il
//            fix uscito non riapribile, e la conversazione che diceva "Filo non
//            ha ancora un parere" su una segnalazione già decisa.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const VERSIONE = '1.0.0';
const SEZIONI = ['inbox', 'queue', 'resolved', 'archived'];

async function apriFeedback(openTab, items, { admin = true, ritardo = 0 } = {}) {
  const page = await openTab(FEEDBACK);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await page.evaluate((ritardo) => {
    window.__updates = [];
    window.__ritardo = ritardo;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__updates.push(msg);
        if (window.__ritardo) await new Promise((r) => setTimeout(r, window.__ritardo));
        return { ok: true };
      }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false };
      return orig(msg);
    };
  }, ritardo);
  await page.evaluate((a) => window.__fbTest.setAdmin(a, { email: 'owner@example.com' }), admin);
  await page.evaluate((v) => window.__fbTest.setReleasedVersion(v), VERSIONE);
  if (items) await page.evaluate((i) => window.__fbTest.setData(i), items);
  return page;
}

async function apriManage(openTab, items, { admin = true } = {}) {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false };
      return orig(msg);
    };
  });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate((v) => window.__mgTest.setReleasedVersion(v), VERSIONE);
  if (items) await page.evaluate((i) => window.__mgTest.setData(i), items);
  return page;
}

const updates = (p) => p.evaluate(() => window.__updates.slice());

// I pulsanti d'azione che la pagina dei feedback offre su UNA scheda.
async function azioniFeedback(page, id) {
  return page.evaluate((id) => {
    const card = document.querySelector(`#list .fb-card[data-id="${CSS.escape(id)}"]`);
    if (!card) return null;
    return Array.from(card.querySelectorAll('.fb-actions button'))
      .map((b) => b.textContent.trim());
  }, id);
}

// I pulsanti d'azione che la dashboard di gestione offre sulla STESSA.
async function azioniManage(page, id) {
  await page.evaluate((id) => window.__mgTest.openDetail(id), id);
  await page.waitForTimeout(60);
  return page.evaluate(() => {
    const row = document.querySelector('#mgActionsRow');
    const box = document.querySelector('#mgActions');
    if (!row || (box && box.hidden)) return [];
    return Array.from(row.querySelectorAll('button')).map((b) => b.textContent.trim());
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// La coda più storta che riesco a costruire: ogni forma di stato che esiste
// nel repo, più quelle che non dovrebbero esistere.
// ═══════════════════════════════════════════════════════════════════════════
const CODA = [
  { _id: 'a01', seq: 1,  status: 'unlabeled',           name: 'non filtrato',  text: 'a', createdAt: '2026-08-01T10:00:00Z' },
  { _id: 'a02', seq: 2,  status: 'attack',              name: 'attacco',       text: 'b', createdAt: '2026-08-02T10:00:00Z' },
  { _id: 'a03', seq: 3,  status: 'spam',                name: 'spam',          text: 'c', createdAt: '2026-08-03T10:00:00Z' },
  { _id: 'a04', seq: 4,  status: 'suspicious_file',     name: 'file sospetto', text: 'd', createdAt: '2026-08-04T10:00:00Z' },
  { _id: 'a05', seq: 5,  status: 'design',              name: 'design',        text: 'e', createdAt: '2026-08-05T10:00:00Z' },
  { _id: 'a06', seq: 6,  status: 'aligned',             name: 'allineato',     text: 'f', createdAt: '2026-08-06T10:00:00Z' },
  { _id: 'a07', seq: 7,  status: 'todo',                name: 'in coda',       text: 'g', createdAt: '2026-08-07T10:00:00Z' },
  { _id: 'a08', seq: 8,  status: 'working',             name: 'lavorazione',   text: 'h', createdAt: '2026-08-08T10:00:00Z' },
  { _id: 'a09', seq: 9,  status: 'revision_capability', name: 'verifica',      text: 'i', createdAt: '2026-08-09T10:00:00Z' },
  { _id: 'a10', seq: 10, status: 'revision_security',   name: 'sicurezza',     text: 'j', createdAt: '2026-08-10T10:00:00Z' },
  { _id: 'a11', seq: 11, status: 'done', fixVersion: '1.0.0', name: 'uscito',  text: 'k', createdAt: '2026-08-11T10:00:00Z' },
  { _id: 'a12', seq: 12, status: 'done', fixVersion: '9.9.9', name: 'non uscito', text: 'l', createdAt: '2026-08-12T10:00:00Z' },
  { _id: 'a13', seq: 13, status: 'archived',            name: 'archiviato',    text: 'm', createdAt: '2026-08-13T10:00:00Z' },
  { _id: 'a14', seq: 14, status: 'attack_confirmed',    name: 'attacco ok',    text: 'n', createdAt: '2026-08-14T10:00:00Z' },
  { _id: 'a15', seq: 15, status: 'spam_confirmed',      name: 'spam ok',       text: 'o', createdAt: '2026-08-15T10:00:00Z' },
  // Vocabolario vecchio, ritirato.
  { _id: 'b01', seq: 16, status: 'new',       name: 'legacy new',      text: 'p', createdAt: '2026-08-16T10:00:00Z' },
  { _id: 'b02', seq: 17, status: 'draft',     name: 'legacy bozza',    text: 'q', createdAt: '2026-08-17T10:00:00Z' },
  { _id: 'b03', seq: 18, status: 'review',    name: 'legacy revisione', text: 'r', createdAt: '2026-08-18T10:00:00Z' },
  { _id: 'b04', seq: 19, status: 'clarify',   name: 'legacy chiarimenti', text: 's', createdAt: '2026-08-19T10:00:00Z' },
  { _id: 'b05', seq: 20, status: 'verified',  name: 'legacy verificato', text: 't', createdAt: '2026-08-20T10:00:00Z' },
  { _id: 'b06', seq: 21, status: 'ignored',   name: 'legacy ignorato', text: 'u', createdAt: '2026-08-21T10:00:00Z' },
  { _id: 'b07', seq: 22, status: 'blocked',   name: 'legacy bloccato', text: 'v', createdAt: '2026-08-22T10:00:00Z' },
  // Storture.
  { _id: 'c01', seq: 23, status: 'inventato', name: 'stato inventato', text: 'w', createdAt: '2026-08-23T10:00:00Z' },
  { _id: 'c02', seq: 24,                      name: 'stato mancante',  text: 'x', createdAt: '2026-08-24T10:00:00Z' },
  { _id: 'c03', seq: 25, status: '',          name: 'stato vuoto',     text: 'y', createdAt: '2026-08-25T10:00:00Z' },
  { _id: 'c04', seq: 26, status: null,        name: 'stato nullo',     text: 'z', createdAt: '2026-08-26T10:00:00Z' },
];

// ═══════════════════════════════════════════════════════════════════════════
// 1 — PARITÀ DELLE AZIONI, segnalazione per segnalazione.
// Il ticket dice "le stesse sezioni contano cose diverse". Il giro 3 ha
// mostrato che sotto le sezioni c'erano azioni diverse. Qui le confronto tutte.
// ═══════════════════════════════════════════════════════════════════════════
test('#509 giro4 — sulla stessa segnalazione le due pagine offrono le stesse azioni', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA);
  const mg = await apriManage(openTab, CODA);

  const diff = [];
  for (const item of CODA) {
    // Vai nella sezione dove vive, su entrambe.
    for (const t of SEZIONI) {
      await fb.evaluate((t) => window.__fbTest.setTab(t), t);
      await fb.waitForTimeout(40);
      const trovato = await fb.evaluate((id) =>
        !!document.querySelector(`#list .fb-card[data-id="${CSS.escape(id)}"]`), item._id);
      if (trovato) break;
    }
    const aFb = await azioniFeedback(fb, item._id);
    const aMg = await azioniManage(mg, item._id);
    const norm = (x) => (x || []).map((s) => s.replace(/^↩\s*/, '').replace(/^→\s*/, '').replace(/^✓\s*/, '').trim()).sort();
    const sFb = JSON.stringify(norm(aFb));
    const sMg = JSON.stringify(norm(aMg));
    if (sFb !== sMg) diff.push(`${item._id} (${item.name}): feedback=${sFb} gestione=${sMg}`);
  }
  expect(diff, 'azioni diverse fra le due pagine').toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 — PARITÀ DELLA SCRITTURA: lo stesso pulsante scrive lo stesso stato.
// Non basta che il bottone si chiami uguale: deve fare la stessa cosa.
// ═══════════════════════════════════════════════════════════════════════════
const SCRITTURE = [
  { id: 'a14', etichetta: 'Ripristina', attesa: 'todo' },   // attacco confermato
  { id: 'a15', etichetta: 'Ripristina', attesa: 'todo' },   // spam confermato
  { id: 'a13', etichetta: 'Ripristina', attesa: 'todo' },   // archiviato normale
  { id: 'b05', etichetta: 'Ripristina', attesa: 'todo' },   // legacy verificato
  { id: 'b06', etichetta: 'Ripristina', attesa: 'todo' },   // legacy ignorato
  { id: 'a04', etichetta: 'Conferma spam', attesa: 'spam_confirmed' },
  { id: 'a04', etichetta: 'Conferma attacco', attesa: 'attack_confirmed' },
  { id: 'a11', etichetta: 'Archivia', attesa: 'archived' },
  { id: 'a07', etichetta: 'Risolto', attesa: 'done' },
];

test('#509 giro4 — lo stesso pulsante scrive lo stesso stato sulle due pagine', async ({ openTab }) => {
  const rotti = [];
  for (const caso of SCRITTURE) {
    const fb = await apriFeedback(openTab, CODA);
    const mg = await apriManage(openTab, CODA);
    // pagina feedback: trova la sezione, poi premi
    let premuto = false;
    for (const t of SEZIONI) {
      await fb.evaluate((t) => window.__fbTest.setTab(t), t);
      await fb.waitForTimeout(40);
      premuto = await fb.evaluate(([id, et]) => {
        const card = document.querySelector(`#list .fb-card[data-id="${CSS.escape(id)}"]`);
        if (!card) return false;
        const b = Array.from(card.querySelectorAll('.fb-actions button'))
          .find((x) => x.textContent.includes(et));
        if (!b) return false;
        b.click(); return true;
      }, [caso.id, caso.etichetta]);
      if (premuto) break;
    }
    await fb.waitForTimeout(250);
    const uFb = await updates(fb);

    await mg.evaluate((id) => window.__mgTest.openDetail(id), caso.id);
    await mg.waitForTimeout(60);
    const premutoMg = await mg.evaluate((et) => {
      const b = Array.from(document.querySelectorAll('#mgActionsRow button'))
        .find((x) => x.textContent.includes(et));
      if (!b) return false;
      b.click(); return true;
    }, caso.etichetta);
    await mg.waitForTimeout(250);
    const uMg = await updates(mg);

    const sFb = uFb.length === 1 ? uFb[0].status : `NIENTE(${uFb.length})`;
    const sMg = uMg.length === 1 ? uMg[0].status : `NIENTE(${uMg.length})`;
    if (!premuto || !premutoMg || sFb !== caso.attesa || sMg !== caso.attesa) {
      rotti.push(`${caso.id} «${caso.etichetta}»: feedback=${premuto ? sFb : 'BOTTONE ASSENTE'} gestione=${premutoMg ? sMg : 'BOTTONE ASSENTE'} (atteso ${caso.attesa})`);
    }
    await fb.close(); await mg.close();
  }
  expect(rotti, 'scritture diverse fra le due pagine').toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 — NESSUN CAMMINO cancella una conferma di sicurezza.
// Il pannello resta aperto mentre lo stato cambia sotto: la scrittura vecchia
// non deve passare.
// ═══════════════════════════════════════════════════════════════════════════
test('#509 giro4 — pannello vecchio: la scrittura che cancellerebbe una conferma non parte', async ({ openTab }) => {
  const CODA2 = CODA.map((f) => ({ ...f }));
  const mg = await apriManage(openTab, CODA2);
  // Apri un attacco (Ricevuti): «Conferma attacco» + «Archivia» sono offerti.
  await mg.evaluate(() => window.__mgTest.openDetail('a02'));
  await mg.waitForTimeout(80);
  const prima = await mg.evaluate(() =>
    Array.from(document.querySelectorAll('#mgActionsRow button')).map((b) => b.textContent.trim()));
  expect(prima.join('|')).toContain('Archivia');

  // Sotto le mani, l'attacco diventa CONFERMATO (l'ha fatto l'altra pagina).
  await mg.evaluate(() => {
    // niente re-render del dettaglio: cambio solo il dato
    const arr = window.__mgTest.currentOrder ? null : null;
  });
  await mg.evaluate(() => {
    const btn = null;
  });
  await mg.evaluate(() => {
    // muta il dato in memoria senza toccare il pannello aperto
    const ev = new Event('noop');
  });
  await mg.evaluate(() => {
    const app = window;
    // accesso al dato via il modulo: rileggo dalla lista renderizzata non basta.
  });
  // Via ufficiale: reinietto la coda con lo stato cambiato, il pannello resta.
  await mg.evaluate((coda) => {
    const c = coda.map((f) => (f._id === 'a02' ? { ...f, status: 'attack_confirmed' } : f));
    // setData ridisegna la lista ma NON chiude il dettaglio aperto
    window.__mgTest.setData(c);
  }, CODA2);
  await mg.waitForTimeout(80);

  // Premi il vecchio «Archivia» rimasto a schermo (se c'è ancora).
  const esito = await mg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#mgActionsRow button'))
      .find((x) => x.textContent.includes('Archivia'));
    if (!b) return 'BOTTONE SPARITO';
    b.click(); return 'PREMUTO';
  });
  await mg.waitForTimeout(250);
  const u = await updates(mg);
  const scritte = u.filter((m) => m.status === 'archived');
  expect(scritte, `su a02 (attacco confermato) è passata una scrittura "archived" — esito clic: ${esito}`).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 — Il computer che NON legge gli stati: le due pagine tacciono uguale.
// ═══════════════════════════════════════════════════════════════════════════
const CIFRATA = CODA.slice(0, 8).map((f, i) => ({
  _id: f._id, seq: f.seq, name: f.name, text: f.text, createdAt: f.createdAt,
  statusEnc: 'AAAA' + i, statusPublic: i % 2 ? 'closed' : 'open',
}));

test('#509 giro4 — stati illeggibili: nessuna delle due pagine inventa numeri o azioni', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CIFRATA);
  const mg = await apriManage(openTab, CIFRATA);
  await fb.waitForTimeout(150); await mg.waitForTimeout(150);

  const barraFb = await fb.evaluate(() => {
    const t = document.querySelector('#tabs');
    return !t || t.hidden || t.offsetParent === null ? null : t.innerText.trim();
  });
  const barraMg = await mg.evaluate(() => {
    const t = document.querySelector('#mgTabs');
    return !t || t.hidden || t.offsetParent === null ? null : t.innerText.trim();
  });
  expect(barraFb, 'la pagina dei feedback disegna ancora le sezioni').toBeNull();
  expect(barraMg, 'la dashboard di gestione disegna ancora le sezioni').toBeNull();

  // Nessuna azione di stato su nessuna delle due.
  const aFb = await azioniFeedback(fb, 'a02');
  const aMg = await azioniManage(mg, 'a02');
  expect(aFb || []).toEqual([]);
  expect(aMg).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 — Il secondo clic (porta del giro 1), col puntatore FERMO.
// ═══════════════════════════════════════════════════════════════════════════
test('#509 giro4 — due e tre clic nello stesso punto scrivono una volta sola', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA, { ritardo: 200 });
  await fb.evaluate(() => window.__fbTest.setTab('inbox'));
  await fb.waitForTimeout(120);
  const box = await fb.locator('#list .fb-card .fb-actions button', { hasText: 'In coda' }).first().boundingBox();
  expect(box).not.toBeNull();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await fb.mouse.click(p.x, p.y);
  await fb.waitForTimeout(400);
  await fb.mouse.click(p.x, p.y);
  await fb.waitForTimeout(400);
  await fb.mouse.click(p.x, p.y);
  await fb.waitForTimeout(500);
  const u = await updates(fb);
  expect(u.length, `scritture: ${JSON.stringify(u.map((m) => [m.id, m.status]))}`).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 — La conversazione su una segnalazione già decisa (porta 5 del giro 3).
// ═══════════════════════════════════════════════════════════════════════════
test('#509 giro4 — una segnalazione decisa non viene descritta come "senza parere"', async ({ openTab }) => {
  const mg = await apriManage(openTab, CODA);
  const bugie = [];
  for (const id of ['a14', 'a15', 'a13', 'a11', 'b05', 'b06']) {
    await mg.evaluate((id) => window.__mgTest.openDetail(id), id);
    await mg.waitForTimeout(80);
    const txt = await mg.evaluate(() => (document.querySelector('#mgDetail')?.innerText || ''));
    if (/non ha ancora un parere|In attesa del giudizio/i.test(txt)) bugie.push(id);
  }
  expect(bugie, 'segnalazioni decise descritte come non ancora giudicate').toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 — Sezioni: nomi, numeri, contenuto e ordine identici (il ticket).
// ═══════════════════════════════════════════════════════════════════════════
test('#509 giro4 — nomi, numeri, contenuto e ordine delle sezioni coincidono', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA);
  const mg = await apriManage(openTab, CODA);
  const out = {};
  for (const t of SEZIONI) {
    await fb.evaluate((t) => window.__fbTest.setTab(t), t);
    await fb.waitForTimeout(80);
    const nomeFb = (await fb.locator(`#tabs [data-tab="${t}"]`).innerText()).trim();
    const dentroFb = await fb.locator('#list .fb-card').evaluateAll((n) => n.map((c) => c.getAttribute('data-id')));
    await mg.evaluate((t) => window.__mgTest.setTab(t), t);
    await mg.waitForTimeout(80);
    const nomeMg = (await mg.locator(`#mgTabs .mg-tab[data-tab="${t}"]`).innerText()).trim();
    const dentroMg = await mg.locator('#mgList .mg-item').evaluateAll((n) => n.map((c) => c.getAttribute('data-id')));
    out[t] = { nomeFb, nomeMg, dentroFb, dentroMg };
  }
  const rotti = [];
  for (const t of SEZIONI) {
    const o = out[t];
    if (o.nomeFb !== o.nomeMg) rotti.push(`${t}: nome/numero «${o.nomeFb}» vs «${o.nomeMg}»`);
    if (JSON.stringify(o.dentroFb) !== JSON.stringify(o.dentroMg)) {
      rotti.push(`${t}: dentro ${JSON.stringify(o.dentroFb)} vs ${JSON.stringify(o.dentroMg)}`);
    }
  }
  expect(rotti).toEqual([]);
  // e nessuna sparita / contata due volte
  const tutte = SEZIONI.flatMap((t) => out[t].dentroFb);
  expect(new Set(tutte).size).toBe(CODA.length);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 — Non-owner: nessuna delle due pagine offre azioni di stato.
// ═══════════════════════════════════════════════════════════════════════════
test('#509 giro4 — senza essere owner nessuna delle due pagine offre azioni', async ({ openTab }) => {
  const fb = await apriFeedback(openTab, CODA, { admin: false });
  const mg = await apriManage(openTab, CODA, { admin: false });
  await fb.waitForTimeout(120); await mg.waitForTimeout(120);
  const aFb = await azioniFeedback(fb, 'a02');
  const aMg = await azioniManage(mg, 'a02');
  expect(aFb || []).toEqual([]);
  expect(aMg).toEqual([]);
});

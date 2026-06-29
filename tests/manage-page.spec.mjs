// Spec Playwright per la pagina di gestione (filo://manage/).
//
// Assert di COMPORTAMENTO:
//   - dashboard unificata (DB1): 6 tab, "Ricevuti" attiva di default; le tab
//     lista (Ricevuti/In coda/Risolti/Archiviati) condividono panel-list;
//     stats/models sono segnaposto;
//   - lo switch "Modalità automatica" è sempre visibile (tutte le tab),
//     si attiva/disattiva e lo stato sopravvive al ricaricamento;
//   - con dati finti iniettati, un blocco compare in "Ricevuti" (richiede la mia
//     approvazione) e il click apre il pannello centrale con le bolle;
//   - un feedback in `clarify` mostra il box risposta dell'owner sotto Ricevuti.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Feedback finto con pipeline "attack" per popolare la lista
const FAKE_FB = {
  _id: 'test-fb-001',
  text: 'Questo è un feedback di test con contenuto malevolo.',
  name: 'Test attacco finto',
  seq: 99,
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-22T10:00:00Z',
  images: [],
  pipeline: {
    action: 'block_attack',
    l1Category: 'dangerous',
    l2Class: 'attack',
    stage: 'L2',
    verdicts: [
      { judge: 'A', class: 'attack', reasoning: 'Questo messaggio tenta di aggirare i filtri di sicurezza.' },
      { judge: 'B', class: 'attack', reasoning: 'Prompt injection rilevata.' },
    ],
    filoSummary: 'Il feedback contiene un tentativo di attacco tramite prompt injection.',
    decidedAt: '2026-06-22T10:01:00Z',
  },
};

test('le 6 tab esistono col testo corretto e "Ricevuti" e\' attiva di default (DB1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // 6 tab della dashboard unificata.
  await expect(page.locator('.mg-tab')).toHaveCount(6);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti');
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda');
  await expect(page.locator('.mg-tab[data-tab="resolved"]')).toHaveText('Risolti');
  await expect(page.locator('.mg-tab[data-tab="archived"]')).toHaveText('Archiviati');
  await expect(page.locator('.mg-tab[data-tab="stats"]')).toHaveText('Statistiche Red Team');
  await expect(page.locator('.mg-tab[data-tab="models"]')).toHaveText('Modelli di supporto');

  // La vecchia tab "Revisione" non esiste più (assorbita in "In coda").
  await expect(page.locator('.mg-tab[data-tab="review"]')).toHaveCount(0);

  // "Ricevuti" attiva di default → mostra il pannello lista condiviso.
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveClass(/mg-tab--active/);
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti');
});

test('le tab-lista condividono panel-list; stats/models sono segnaposto "In arrivo" (DB1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Le 4 tab-lista usano lo STESSO pannello (panel-list), cambia solo l'intestazione.
  for (const [tab, head] of [['queue', 'In coda'], ['resolved', 'Risolti'], ['archived', 'Archiviati'], ['inbox', 'Ricevuti']]) {
    await page.locator(`.mg-tab[data-tab="${tab}"]`).click();
    await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
    await expect(page.locator('#mgListHead')).toHaveText(head);
  }

  // Statistiche Red Team → segnaposto dedicato.
  await page.locator('.mg-tab[data-tab="stats"]').click();
  await expect(page.locator('#panel-stats')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#panel-stats .mg-coming')).toBeVisible();
  await expect(page.locator('#panel-list')).not.toHaveClass(/mg-panel--active/);

  // Modelli di supporto → pannello dedicato (DD1: non più un segnaposto).
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#panel-models')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#panel-list')).not.toHaveClass(/mg-panel--active/);
});

test('lo switch "Modalità automatica" è sempre visibile ed è read-only per i non-admin', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const sw    = page.locator('#mgAutoSwitch');
  const input = page.locator('#mgAutoToggle');

  // Sempre visibile sulla tab di default
  await expect(sw).toBeVisible();
  // Resta visibile anche cambiando tab (non è una sezione, è uno switch globale)
  await page.locator('.mg-tab[data-tab="stats"]').click();
  await expect(sw).toBeVisible();
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await expect(sw).toBeVisible();

  // Da non-admin (userData pulito → nessuna sessione) lo switch è disabilitato:
  // stesso contratto di sola lettura del banner.
  await expect(input).toBeDisabled();
  await expect(sw).toHaveClass(/mg-switch--disabled/);
});

test('lo switch attiva/disattiva la modalità automatica e lo stato persiste', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const input = page.locator('#mgAutoToggle');
  const state = page.locator('#mgAutoState');

  // Stato iniziale: spento.
  await expect(input).not.toBeChecked();
  await expect(state).toHaveText('Off');

  // DA3: a riposo la pista è un grigio marcato (`--sn-muted`), non più
  // `--sn-border` che sul tema chiaro era quasi invisibile. Confronto col valore
  // del token risolto in rgb → theme-independent, rosso se si torna a --sn-border.
  const trackOk = await page.evaluate(() => {
    const track = document.querySelector('.mg-switch-track');
    const bg = getComputedStyle(track).backgroundColor;
    const probe = document.createElement('span');
    probe.style.color = 'var(--sn-muted)';
    document.body.appendChild(probe);
    const muted = getComputedStyle(probe).color;
    probe.style.color = 'var(--sn-border)';
    const border = getComputedStyle(probe).color;
    probe.remove();
    return { isMuted: bg === muted, isBorder: bg === border };
  });
  expect(trackOk.isMuted).toBe(true);
  expect(trackOk.isBorder).toBe(false);

  // Simula l'owner: abilita lo switch (in produzione lo abilita applyAutoModeGate
  // quando isAdmin è true) e attivalo. Il change handler scrive su storage.
  // Simula l'owner che accende lo switch. Il checkbox nativo è visivamente
  // nascosto (switch custom), quindi azioniamo direttamente il controllo reale:
  // settiamo checked e scateniamo 'change', cioè il vero handler che persiste.
  await page.evaluate(() => {
    const el = document.getElementById('mgAutoToggle');
    el.disabled = false;
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(input).toBeChecked();
  await expect(state).toHaveText('On');

  // Lo stato è stato persistito in chrome.storage.local.
  const stored = await page.evaluate(async () => {
    const d = await window.chrome.storage.local.get('filo_auto_mode');
    return d.filo_auto_mode;
  });
  expect(stored).toBe(true);

  // Sopravvive al ricaricamento della pagina (loadAutoMode rilegge da storage).
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#mgAutoToggle')).toBeChecked();
  await expect(page.locator('#mgAutoState')).toHaveText('On');
});

test('con dati finti: un elemento su UNA riga (#N + titolo, niente label motivo) — DA2', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  // Esercita il VERO renderList tramite l'hook di test (niente replica manuale).
  // Un blocco "attacco" vive nella tab "In coda": selezionala.
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);
  await page.evaluate((fb) => { window.__mgTest.setData([fb]); window.__mgTest.setTab('queue'); }, FAKE_FB);

  // Un elemento in lista, col numero e il titolo.
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Test attacco finto');
  await expect(page.locator('.mg-item-num')).toHaveText('#99');

  // DA2: la label testuale del motivo è stata rimossa (resta solo il colore del
  // border-left). Il titolo è su una riga sola (no clamp a 2 righe).
  await expect(page.locator('.mg-item-reason')).toHaveCount(0);
  const whiteSpace = await page.locator('.mg-item-title').evaluate(
    (el) => getComputedStyle(el).whiteSpace
  );
  expect(whiteSpace).toBe('nowrap');

  // Il border-left porta ancora il colore della classe (attacco = rosso).
  const borderColor = await page.locator('.mg-item').evaluate(
    (el) => getComputedStyle(el).borderLeftColor
  );
  expect(borderColor).not.toBe('rgba(0, 0, 0, 0)'); // non trasparente
});

// Redesign routine: un feedback bloccato per LOOP (3 verifiche fallite di fila)
// deve avere il bordo NERO, distinto dai blocchi del pipeline di sicurezza.
const FAKE_FB_LOOP = {
  _id: 'test-fb-loop',
  text: 'Fix bloccato dopo tre verifiche avversariali fallite.',
  name: 'Test blocco loop',
  seq: 77,
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-27T10:00:00Z',
  images: [],
  status: 'blocked',
  blockReason: 'loop',
};

test('un blocco per LOOP (blocked + blockReason=loop) ha il border-left NERO', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  // Verifica la logica pura: classifyBlock → reason 'loop', colore nero.
  const cl = await page.evaluate((fb) => window.SN_MANAGE_REVIEW.classifyBlock(fb), FAKE_FB_LOOP);
  expect(cl).not.toBeNull();
  expect(cl.reason).toBe('loop');
  expect(cl.color).toBe('#111111');

  // Esercita il VERO renderList: il blocco loop vive in "In coda".
  await page.evaluate((fb) => { window.__mgTest.setData([fb]); window.__mgTest.setTab('queue'); }, FAKE_FB_LOOP);

  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Test blocco loop');

  // Border-left NERO (#111111 → rgb(17, 17, 17)), distinto dal rosso/arancio/blu.
  const borderColor = await page.locator('.mg-item').evaluate(
    (el) => getComputedStyle(el).borderLeftColor
  );
  expect(borderColor).toBe('rgb(17, 17, 17)');
});

test('il pannello centrale si apre al click e mostra bolle + giudici', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.SN_FEEDBACK !== 'undefined');

  // Inietta direttamente il feedback nel DOM e nell'allFeedbacks globale
  // simulando ciò che farebbe manage.js dopo loadData()
  await page.evaluate((fakeFb) => {
    const MR = window.SN_MANAGE_REVIEW;
    const FB = window.SN_FEEDBACK;

    // Ricalcola la lista con il feedback finto
    const blocked = MR.sortReview([fakeFb].filter(f => MR.classifyBlock(f) !== null));

    const mgListLoading = document.getElementById('mgListLoading');
    const mgList = document.getElementById('mgList');
    const mgListEmpty = document.getElementById('mgListEmpty');
    if (mgListLoading) mgListLoading.hidden = true;
    if (mgListEmpty)   mgListEmpty.hidden = true;
    if (!mgList) return;
    mgList.hidden = false;
    mgList.innerHTML = '';

    // Serve una reference all'allFeedbacks — la inseriamo come variabile globale
    window.__testFeedbacks__ = [fakeFb];

    for (const fb of blocked) {
      const cl = MR.classifyBlock(fb);
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';
      const item = document.createElement('div');
      item.className = 'mg-item';
      item.dataset.id = fb._id;
      item.style.borderLeftColor = cl ? cl.color : 'transparent';
      item.innerHTML = (num ? `<span class="mg-item-num">#${num}</span>` : '')
        + `<span class="mg-item-title">${title}</span>`;

      item.addEventListener('click', () => {
        // Simula openDetail: mostra pannello centrale
        const empty  = document.getElementById('mgDetailEmpty');
        const detail = document.getElementById('mgDetail');
        const head   = document.getElementById('mgDetailHead');
        const thread = document.getElementById('mgThread');
        const judgesRow = document.getElementById('mgJudgesRow');
        if (!detail || !empty) return;
        empty.hidden = true;
        detail.hidden = false;

        head.innerHTML = `Da <a class="mg-sender-link" href="#" data-client="${fb.clientId}">${fb.clientId}</a> il 22/06/2026`;

        // Giudici
        judgesRow.innerHTML = '<span class="mg-judge-label">Giudici:</span>';
        const verdicts = (fb.pipeline && fb.pipeline.verdicts) || [];
        const letters = ['A','B','C','D'];
        for (let i = 0; i < 4; i++) {
          const v = verdicts[i];
          const dot = document.createElement('span');
          dot.className = 'mg-dot' + (v ? ' mg-dot--clickable mg-dot--' + (v.class||'') : '');
          dot.dataset.judge = letters[i];
          judgesRow.appendChild(dot);
        }

        // Bolle
        thread.innerHTML = '';
        const b1 = document.createElement('div');
        b1.className = 'mg-bubble mg-bubble--user';
        b1.innerHTML = `<div class="mg-bubble-who">Utente</div><div class="mg-bubble-body">${fb.text}</div>`;
        thread.appendChild(b1);

        const b2 = document.createElement('div');
        b2.className = 'mg-bubble mg-bubble--model';
        const summary = fb.pipeline && fb.pipeline.filoSummary;
        b2.innerHTML = `<div class="mg-bubble-who">Filo</div><div class="mg-bubble-body">${summary || '<em>Filo non ha ancora un parere su questo feedback (giudici non attivi).</em>'}</div>`;
        thread.appendChild(b2);
      });

      mgList.appendChild(item);
    }
  }, FAKE_FB);

  // Prima del click: pannello centrale nascosto
  await expect(page.locator('#mgDetailEmpty')).toBeVisible();
  await expect(page.locator('#mgDetail')).toBeHidden();

  // Click sull'elemento
  await page.locator('.mg-item').click();

  // Dopo il click: pannello centrale visibile
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgDetailEmpty')).toBeHidden();

  // Intestazione con il mittente
  await expect(page.locator('#mgDetailHead')).toContainText('tester@example.com');

  // 4 pallini giudici (2 pieni attack + 2 grigi)
  await expect(page.locator('#mgJudgesRow .mg-dot')).toHaveCount(4);
  await expect(page.locator('#mgJudgesRow .mg-dot--attack')).toHaveCount(2);

  // 2 bolle: utente + Filo
  await expect(page.locator('#mgThread .mg-bubble')).toHaveCount(2);
  await expect(page.locator('#mgThread .mg-bubble--user')).toBeVisible();
  await expect(page.locator('#mgThread .mg-bubble--model')).toBeVisible();

  // La bolla di Filo contiene il filoSummary
  await expect(page.locator('#mgThread .mg-bubble--model .mg-bubble-body'))
    .toContainText('prompt injection');
});

test('click su un pallino giudice apre il reasoning nel pannello destro; il centro non lo contiene piu (DA1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);

  // Esercita il VERO codice di rendering tramite l'hook di test.
  await page.evaluate((fb) => {
    window.__mgTest.setData([fb]);
    window.__mgTest.openDetail(fb._id);
  }, FAKE_FB);

  // Il centro NON contiene più i verdetti estesi (rimossi da DA1).
  await expect(page.locator('#mgVerdicts')).toHaveCount(0);
  await expect(page.locator('#mgDetail')).not.toContainText('aggirare i filtri');

  // Il pannello destro parte chiuso (stato vuoto visibile).
  await expect(page.locator('#mgSideEmpty')).toBeVisible();
  await expect(page.locator('#mgSide')).toBeHidden();

  // Click sul PRIMO pallino con verdetto → apre quel giudice a destra col reasoning.
  await page.locator('#mgJudgesRow .mg-dot--clickable').first().click();
  await expect(page.locator('#mgSide')).toBeVisible();
  await expect(page.locator('#mgSideBody')).toContainText('aggirare i filtri');
  // Il badge della classe è presente nel pannello.
  await expect(page.locator('#mgSideBody .mg-class-badge')).toBeVisible();

  // Click sul SECONDO pallino → il pannello mostra il secondo reasoning.
  await page.locator('#mgJudgesRow .mg-dot--clickable').nth(1).click();
  await expect(page.locator('#mgSideBody')).toContainText('Prompt injection');
});

test('nome giudice nel pannello destro: anonimizzato per i non-owner, modello reale per l owner (#2, DA1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);

  const FB_MODEL = {
    ...FAKE_FB,
    _id: 'fb-model-001',
    pipeline: {
      ...FAKE_FB.pipeline,
      verdicts: [{ judge: 'A', class: 'attack', reasoning: 'x', model: 'gemini-3.1-flash-lite' }],
    },
  };

  // Non-owner → titolo del pannello anonimizzato "Giudice A".
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(false);
    window.__mgTest.setData([fb]);
    window.__mgTest.openDetail(fb._id);
  }, FB_MODEL);
  await page.locator('#mgJudgesRow .mg-dot--clickable').first().click();
  await expect(page.locator('#mgSideTitle')).toHaveText('Giudice A');

  // Owner → titolo del pannello = nome del modello reale.
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.openDetail(fb._id);
  }, FB_MODEL);
  await page.locator('#mgJudgesRow .mg-dot--clickable').first().click();
  await expect(page.locator('#mgSideTitle')).toHaveText('gemini-3.1-flash-lite');
});

test('owner accetta e sblocca un feedback bloccato → patch corretto + esce dai bloccati (#4)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  // Intercetta feedback_update: cattura il patch e risponde ok, senza rete/main.
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });

  // Owner + dati + tab "In coda" + apri dettaglio (vero codice di rendering).
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, FAKE_FB);

  // Per l'owner le azioni di sblocco sono visibili; un elemento è in lista.
  await expect(page.locator('#mgActions')).toBeVisible();
  await expect(page.locator('.mg-item')).toHaveCount(1);
  // Il blocco "attacco" colora il border-left di rosso.
  const beforeColor = await page.locator('.mg-item').evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(beforeColor).not.toBe('rgba(0, 0, 0, 0)');

  // Scrivi un commento e accetta.
  await page.locator('#mgAcceptComment').fill('Falso positivo: richiesta legittima.');
  await page.locator('#mgAcceptBtn').click();

  // Il patch inviato contiene l'override + il ritorno in coda + il commento.
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.reviewDecision).toBe('accepted');
  expect(patch.status).toBe('todo');
  expect(patch.reviewComment).toContain('Falso positivo');

  // Esce dai bloccati: il dettaglio si richiude. Resta in "In coda" come `todo`,
  // ma senza più il colore di blocco (border-left trasparente).
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('.mg-item')).toHaveCount(1);
  const afterColor = await page.locator('.mg-item').evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(afterColor).toBe('rgba(0, 0, 0, 0)');
});

test('un feedback in `clarify` mostra il box risposta dell owner sotto Ricevuti (DB1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  // Intercetta feedback_update per catturare il patch senza rete/main.
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });

  const CLARIFY_FB = {
    _id: 'fb-clarify-001',
    text: 'Il pulsante X non funziona.',
    name: 'Pulsante X',
    seq: 42, subSeq: 0,
    status: 'clarify',
    notes: '--- Filo ---\nQuale pulsante X intendi? Non lo trovo.',
    clientId: 'tester@example.com',
    createdAt: '2026-06-22T10:00:00Z',
    images: [],
  };

  // Owner, tab Ricevuti di default: i `clarify` vivono lì.
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
  }, CLARIFY_FB);

  // Compare in Ricevuti.
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti');
  await expect(page.locator('.mg-item')).toHaveCount(1);

  // Apri il dettaglio: il box risposta chiarimenti è visibile, lo sblocco no.
  await page.evaluate((id) => window.__mgTest.openDetail(id), CLARIFY_FB._id);
  await expect(page.locator('#mgClarify')).toBeVisible();
  await expect(page.locator('#mgActions')).toBeHidden();
  // Niente riga giudici per un feedback mai passato dal pipeline.
  await expect(page.locator('#mgJudgesRow')).toBeHidden();

  // Rispondi: il patch rimette in coda (todo) e appende la risposta alle note.
  await page.locator('#mgClarifyText').fill('Intendo il pulsante in alto a destra.');
  await page.locator('#mgClarifyBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.status).toBe('todo');
  expect(patch.notes).toContain('Intendo il pulsante in alto a destra');
  // La risposta data, il feedback lascia Ricevuti (diventa todo → In coda).
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('.mg-item')).toHaveCount(0);
});

// ── DB2: stato `archived` + preferito ⭐ ────────────────────────────────────
const FB_ARCHIVED = {
  _id: 'fb-arch-001', text: 'Feedback archiviato.', name: 'Archiviato',
  seq: 10, subSeq: 0, status: 'archived',
  clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z', images: [],
};
const FB_STARRED_TODO = {
  _id: 'fb-star-001', text: 'Preferito ma in coda.', name: 'Preferito in coda',
  seq: 11, subSeq: 0, status: 'todo', starred: true,
  clientId: 'tester@example.com', createdAt: '2026-06-21T10:00:00Z', images: [],
};
const FB_PLAIN_TODO = {
  _id: 'fb-plain-001', text: 'Feedback normale in coda.', name: 'Normale in coda',
  seq: 12, subSeq: 0, status: 'todo',
  clientId: 'tester@example.com', createdAt: '2026-06-22T10:00:00Z', images: [],
};

function stubFeedbackUpdate(page) {
  return page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
}

test('tab Archiviati: OFF mostra i soli archiviati, il filtro ⭐ mostra tutti i preferiti (DB2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);

  await page.evaluate((fbs) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('archived');
  }, [FB_ARCHIVED, FB_STARRED_TODO, FB_PLAIN_TODO]);

  // Il filtro ⭐ esiste solo nella tab Archiviati.
  await expect(page.locator('#mgArchiveFilter')).toBeVisible();

  // Filtro OFF: solo i feedback in stato `archived` (non i preferiti in coda).
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Archiviato');

  // Filtro ⭐ ON: tutti e soli i preferiti, di qualunque stato (qui il todo ⭐).
  await page.locator('#mgStarFilter').check();
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Preferito in coda');

  // Il filtro sparisce sulle altre tab.
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('#mgArchiveFilter')).toBeHidden();
});

test('owner archivia un feedback dalla coda → patch status:archived + lascia la coda (DB2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await stubFeedbackUpdate(page);

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, FB_PLAIN_TODO);

  // I controlli di gestione sono visibili per l'owner; bottone "Archivia".
  await expect(page.locator('#mgManage')).toBeVisible();
  await expect(page.locator('#mgArchiveBtn')).toHaveText('Archivia');
  await expect(page.locator('.mg-item')).toHaveCount(1);

  await page.locator('#mgArchiveBtn').click();

  // Patch corretto: status → archived.
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.status).toBe('archived');

  // Esce dalla coda: il dettaglio si richiude e la lista "In coda" si svuota.
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('.mg-item')).toHaveCount(0);
});

test('owner mette/leva il preferito ⭐ → patch starred + il bottone riflette lo stato (DB2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await stubFeedbackUpdate(page);

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, FB_PLAIN_TODO);

  const star = page.locator('#mgStarBtn');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(star).toContainText('☆');

  await star.click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.starred).toBe(true);

  // Il bottone riflette lo stato acceso (★, aria-pressed true).
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(star).toContainText('★');
});

test('owner ripristina un feedback archiviato → bottone "Ripristina" + patch status:todo (DB2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await stubFeedbackUpdate(page);

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('archived');
    window.__mgTest.openDetail(fb._id);
  }, FB_ARCHIVED);

  // Su un feedback già archiviato il bottone ripristina.
  await expect(page.locator('#mgArchiveBtn')).toHaveText('Ripristina');
  await page.locator('#mgArchiveBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.status).toBe('todo');

  // Lascia gli Archiviati.
  await expect(page.locator('.mg-item')).toHaveCount(0);
});

test('la pagina carica senza errori JavaScript', async ({ openTab }) => {
  const errors = [];
  const page = await openTab(URL);
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForLoadState('domcontentloaded');
  // Attendi un po' per errori asincroni (fetch Firestore ecc. → ignorabili)
  await page.waitForTimeout(800);
  // Filtra errori di rete (fetch falliti in test senza Firestore): quelli sono attesi
  const jsErrors = errors.filter(
    (e) => !e.includes('fetch') && !e.includes('Failed to fetch') &&
            !e.includes('firestore') && !e.includes('network') &&
            !e.includes('canale main')
  );
  expect(jsErrors).toHaveLength(0);
});

// ── DB3: "In produzione" = fix uscito in una versione rilasciata ─────────────
// Un `done` con resolvedInVersion ≤ versione rilasciata appare in "Risolti";
// un `done` con versione futura (non ancora spedito) resta in "In coda".
// Esercita il VERO renderList via l'hook di test (niente replica manuale della
// logica): inietta i feedback, fissa la versione rilasciata e cambia tab.
test('DB3: solo i fix rilasciati appaiono in Risolti; i non-spediti restano In coda', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  const shipped = {
    _id: 'db3-shipped', name: 'Fix gia rilasciato', seq: 201, subSeq: 0,
    status: 'done', resolvedInVersion: '0.2.70',
    clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z', images: [],
  };
  const pending = {
    _id: 'db3-pending', name: 'Fix non ancora spedito', seq: 202, subSeq: 0,
    status: 'done', resolvedInVersion: '0.2.99',
    clientId: 'tester@example.com', createdAt: '2026-06-21T10:00:00Z', images: [],
  };

  await page.evaluate(({ a, b }) => {
    window.__mgTest.setData([a, b]);
    window.__mgTest.setReleasedVersion('0.2.74');
  }, { a: shipped, b: pending });

  // Tab "Risolti": solo il fix spedito.
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Fix gia rilasciato');

  // Tab "In coda": il done non ancora spedito è qui (visibile finché non esce).
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Fix non ancora spedito');

  // Quando la versione rilasciata raggiunge quella del fix, passa a "Risolti".
  await page.evaluate(() => window.__mgTest.setReleasedVersion('0.2.99'));
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  await expect(page.locator('.mg-item')).toHaveCount(2);
});

// ── DD1: Sezione "Modelli di supporto" ──────────────────────────────────────

// Modelli finti restituiti dal mock di support_models_get.
const FAKE_SUPPORT_MODELS = {
  sanitizer:    'flash',
  judge1:       'flash, flash-or',
  judge2:       'flash',
  judge3:       'flash',
  judgeDynamic: 'flash',
  judgeRedTeam: 'flash',
  judgePriority: '',
};

// Stub IPC: intercetta support_models_get e support_models_update senza rete.
async function stubSupportModels(page, initialModels, isAdmin = true) {
  await page.evaluate(({ models, admin }) => {
    window.__smUpdates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { isAdmin: admin };
      if (msg && msg.type === 'support_models_get') {
        if (!admin) return { ok: false, error: 'non admin' };
        return { ok: true, models };
      }
      if (msg && msg.type === 'support_models_update') {
        window.__smUpdates.push(msg.models);
        return { ok: true, models: msg.models };
      }
      return orig(msg);
    };
  }, { models: initialModels, admin: isAdmin });
}

test('DD1: la tab Modelli di supporto renderizza tutti gli slot col modelChainEditor', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  await stubSupportModels(page, FAKE_SUPPORT_MODELS);

  // Clicca la tab: innesca il caricamento lazy.
  await page.locator('.mg-tab[data-tab="models"]').click();

  // Attendi che l'editor sia visibile (caricamento IPC completato).
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });

  // 7 slot presenti nel DOM (sanitizer + 3 giudici fissi + dinamico + red-team + priorità).
  await expect(page.locator('.mg-sm-slot')).toHaveCount(7);
  await expect(page.locator('[data-slot="sanitizer"]')).toBeVisible();
  await expect(page.locator('[data-slot="judge1"]')).toBeVisible();
  await expect(page.locator('[data-slot="judge2"]')).toBeVisible();
  await expect(page.locator('[data-slot="judge3"]')).toBeVisible();
  await expect(page.locator('[data-slot="judgeDynamic"]')).toBeVisible();
  await expect(page.locator('[data-slot="judgeRedTeam"]')).toBeVisible();
  await expect(page.locator('[data-slot="judgePriority"]')).toBeVisible();
  // Il vecchio slot unico non deve più esistere.
  await expect(page.locator('[data-slot="judgeL2"]')).toHaveCount(0);

  // I 4 giudici del panel mostrano etichette amichevoli (non l'id grezzo).
  await expect(page.locator('[data-slot="judge1"] label')).toHaveText('Giudice 1');
  await expect(page.locator('[data-slot="judge2"] label')).toHaveText('Giudice 2');
  await expect(page.locator('[data-slot="judge3"] label')).toHaveText('Giudice 3');
  await expect(page.locator('[data-slot="judgeDynamic"] label')).toHaveText('Giudice dinamico');

  // Ogni slot ha almeno un input (modelChainEditor crea .sn-chain-input per ogni segmento).
  const chainInputs = page.locator('.mg-sm-chain-host .sn-chain-input');
  const count = await chainInputs.count();
  expect(count).toBeGreaterThanOrEqual(7);

  // Il bottone "Salva" è visibile.
  await expect(page.locator('#mgSmSaveBtn')).toBeVisible();
});

test('DD1: i valori caricati popolano i campi (slot con catena ha più segmenti)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  await stubSupportModels(page, FAKE_SUPPORT_MODELS);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });

  // Lo slot "sanitizer" ha valore "flash" → un solo input con "flash".
  const sanitizerHost = page.locator('#mgSmChain-sanitizer');
  const sanitizerInput = sanitizerHost.locator('.sn-chain-input').first();
  await expect(sanitizerInput).toHaveValue('flash');

  // Lo slot "judge1" ha valore "flash, flash-or" → due segmenti (due input).
  const judge1Inputs = page.locator('#mgSmChain-judge1 .sn-chain-input');
  await expect(judge1Inputs).toHaveCount(2);
  await expect(judge1Inputs.nth(0)).toHaveValue('flash');
  await expect(judge1Inputs.nth(1)).toHaveValue('flash-or');

  // judge2/judge3/judgeDynamic hanno valori indipendenti (un solo segmento "flash").
  await expect(page.locator('#mgSmChain-judge2 .sn-chain-input')).toHaveValue('flash');
  await expect(page.locator('#mgSmChain-judge3 .sn-chain-input')).toHaveValue('flash');
  await expect(page.locator('#mgSmChain-judgeDynamic .sn-chain-input')).toHaveValue('flash');
});

test('DD1: il bottone Salva invia support_models_update con i valori corretti', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  await stubSupportModels(page, FAKE_SUPPORT_MODELS);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });

  // Salva senza modifiche.
  await page.locator('#mgSmSaveBtn').click();

  // La IPC support_models_update è stata chiamata una volta.
  await expect.poll(() => page.evaluate(() => window.__smUpdates.length)).toBe(1);
  const sent = await page.evaluate(() => window.__smUpdates[0]);

  // Tutti gli slot sono presenti nel payload, con uno slot per giudice del panel.
  expect(sent).toHaveProperty('sanitizer');
  expect(sent).toHaveProperty('judge1');
  expect(sent).toHaveProperty('judge2');
  expect(sent).toHaveProperty('judge3');
  expect(sent).toHaveProperty('judgeDynamic');
  expect(sent).toHaveProperty('judgeRedTeam');
  expect(sent).toHaveProperty('judgePriority');
  // Il vecchio slot unico non viene più inviato.
  expect(sent).not.toHaveProperty('judgeL2');

  // I 4 giudici persistono in modo indipendente: i valori distinti del mock
  // arrivano ognuno nel proprio slot (judge1 catena, gli altri "flash").
  expect(sent.judge1).toBe('flash, flash-or');
  expect(sent.judge2).toBe('flash');
  expect(sent.judge3).toBe('flash');
  expect(sent.judgeDynamic).toBe('flash');

  // I valori tornati dal mock vengono confermati (status "Salvato.").
  await expect(page.locator('#mgSmStatus')).toHaveText('Salvato.');
});

test('DD1: per i non-admin la sezione mostra il messaggio di accesso negato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  // Stub con admin=false.
  await stubSupportModels(page, {}, false);
  await page.locator('.mg-tab[data-tab="models"]').click();

  // Aspetta che il caricamento finisca (il denied appare subito dopo la risposta).
  await expect(page.locator('#mgSmDenied')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#mgSmEditor')).toBeHidden();
});

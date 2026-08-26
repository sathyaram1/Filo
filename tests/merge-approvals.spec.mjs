// L'AVVISO DELLE FUSIONI IN ATTESA — SPEC-RIDISEGNO-MAX.md §10.
//
// COSA DEVE ESSERE VERO
//   I controlli deterministici del server fermano le fusioni che toccano le
//   aree protette. Il lavoro locale dell'owner ci cade dentro quasi sempre, e
//   senza una superficie dove approvarlo non avrebbe nessuna strada verso il
//   ramo principale. Quella superficie è UNA (scelta owner 2026-08-26): la
//   dashboard di gestione, in cima ai Ricevuti — dove stanno le altre cose che
//   aspettano una decisione dell'owner. E deve rispettare queste cose:
//
//     1. l'owner con una richiesta in attesa la trova IN CIMA AI RICEVUTI,
//        senza cercarla — e ANCHE SE la pagina era già aperta: prima l'elenco
//        si leggeva solo all'apertura, quindi l'avviso di cui parla il
//        terminale non compariva mai sotto gli occhi di chi lo aspettava;
//     2. l'owner SENZA richieste non vede niente, e sulle ALTRE schede
//        l'avviso non compare (i Ricevuti sono il posto delle decisioni,
//        le altre schede no);
//     3. un utente qualunque non la vede MAI, e il main gli risponde di no
//        anche se prova a chiamare il comando a mano; una scheda su un sito
//        qualunque non riceve nemmeno l'avviso di aggiornamento (dice su cosa
//        sta lavorando l'owner);
//     4. la prima schermata del browser NON la mostra più: la home di tutti i
//        giorni non è il posto delle pratiche dell'owner;
//     5. la scheda dice CHI ha chiesto la fusione e — per il lavoro delle
//        automazioni — DA QUALE segnalazione nasce, con un click per aprirla.
//
//   In più: approvare non parte al primo click (è irreversibile), e "Scarta"
//   toglie la richiesta senza fondere niente.
//
// COME
//   In test non c'è né una sessione da proprietario né il backend di sicurezza:
//   si stubba il canale verso il main (stesso schema di manage-page.spec.mjs) e
//   si ripercorre il codice VERO di lettura e disegno. Il gate d'origine e il
//   gate proprietario si verificano invece SENZA stub, sul main vero.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const MANAGE = 'filo://manage/manage.html';

const SHA = 'a1b2c3d4'.repeat(5);

const GIORNO = 24 * 60 * 60 * 1000;

function richiesta(over = {}) {
  return Object.assign({
    id: 'ab12cd34ef56ab12cd34ef56',
    branch: 'claude/approvazione-fusioni',
    sha: SHA,
    who: 'owner@esempio',
    blocks: [
      { gate: 'guard_the_guards', label: 'Tocca aree protette (guardie, regole del database, chiavi, automatismi)', items: ['firestore.rules', 'scripts/lib/owner-merge.mjs'], more: 0 },
      { gate: 'dependency_change', label: 'Cambia le dipendenze del progetto', items: ['package.json'], more: 0 },
    ],
    createdAtMs: Date.now() - 2 * 60 * 1000,
    expiresAtMs: Date.now() + GIORNO - 2 * 60 * 1000,
    expired: false,
    used: false,
    discarded: false,
  }, over);
}

/**
 * Quello che fa il main quando il campanello suona: rilegge e manda l'elenco
 * alle pagine filo:// aperte. Si usa la funzione VERA di broadcast
 * (globalThis.SN_BROADCAST_FILO), non una copia.
 */
async function avvisaDalMain(app, payload) {
  await app.evaluate((_electron, msg) => globalThis.SN_BROADCAST_FILO(msg), {
    type: 'merge_approvals_changed',
    pending: payload.pending || [],
    recent: payload.recent || [],
    ttlMs: GIORNO,
  });
}

/**
 * Sostituisce il canale verso il main: chi sono (proprietario o no) e cosa c'è
 * in attesa. Tutto il resto passa all'handler vero.
 *
 * Registra le chiamate di approvazione/scarto su `window.__macCalls`, così si
 * può asserire che il gesto è arrivato davvero al main — non solo che la UI ha
 * cambiato colore.
 */
async function stubApprovals(page, { admin = true, pending = [], recent = [], approveReply = null } = {}) {
  await page.evaluate((cfg) => {
    window.__macCalls = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (t === 'merge_approvals_get') {
        if (!cfg.admin) return { ok: false, error: 'Operazione riservata agli amministratori.' };
        return { ok: true, pending: cfg.pending, recent: cfg.recent, ttlMs: 24 * 60 * 60 * 1000 };
      }
      if (t === 'merge_approval_approve') {
        window.__macCalls.push({ op: 'approve', id: msg.id });
        return cfg.approveReply || { ok: true, result: 'merged', sha: 'deadbeefcafe' };
      }
      if (t === 'merge_approval_discard') {
        window.__macCalls.push({ op: 'discard', id: msg.id });
        return { ok: true, result: 'discarded' };
      }
      return orig(msg);
    };
  }, { admin, pending, recent, approveReply });
}

/** Gestione, sulla scheda di partenza: i Ricevuti. */
async function apriGestione(page, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubApprovals(page, opts);
  await page.evaluate((admin) => window.__mgTest.setAdmin(admin), opts?.admin !== false);
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

/** Gestione → Automazioni: dove vive la traccia delle decisioni passate. */
async function apriAutomazioni(page, opts) {
  await apriGestione(page, opts);
  await page.locator('.mg-tab[data-tab="automation"]').click();
}

// ── 1. L'owner la trova in cima ai Ricevuti ─────────────────────────────────

test('Ricevuti: con una fusione in attesa l’avviso c’è, e dice ramo, commit e perché', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta()] });

  // Si vede restando sulla scheda di partenza, senza andare a cercarlo.
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveClass(/mg-tab--active/);
  const avviso = page.locator('#mgMergeApprovals .sn-mac');
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await expect(avviso).toContainText('Una fusione aspetta il tuo via libera');
  await expect(avviso).toContainText('claude/approvazione-fusioni');
  await expect(avviso).toContainText(SHA.slice(0, 8));
  // I motivi del blocco in parole dell'owner: senza, "approva" è un sì al buio.
  await expect(avviso).toContainText('Tocca aree protette');
  await expect(avviso).toContainText('firestore.rules');
  await expect(avviso).toContainText('Cambia le dipendenze del progetto');
  // La scadenza si dice PRIMA, non premendo il bottone — e la finestra è di un
  // giorno, quindi si legge in ore.
  await expect(avviso.locator('.sn-mac-expiry')).toContainText(/scade fra \d+ ore/);

  // IN CIMA: sotto la barra delle schede, sopra la lista dei feedback.
  const suo = await avviso.boundingBox();
  const schede = await page.locator('#mgTabs').boundingBox();
  const lista = await page.locator('#mgReviewGrid').boundingBox();
  expect(suo.y).toBeGreaterThanOrEqual(schede.y + schede.height - 1);
  expect(suo.y + suo.height).toBeLessThanOrEqual(lista.y + 1);
});

test('due richieste = due schede, e il titolo lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, {
    pending: [richiesta(), richiesta({ id: 'ff'.repeat(12), branch: 'claude/altro' })],
  });
  await expect(page.locator('#mgMergeApprovals .sn-mac-card')).toHaveCount(2);
  await expect(page.locator('#mgMergeApprovals .sn-mac')).toContainText('2 fusioni aspettano');
});

test('la scheda dice CHI ha chiesto la fusione', async ({ openTab }) => {
  // Questa superficie esiste per separare chi chiede da chi approva: il server
  // manda già l'identità della richiesta, e non mostrarla le toglieva metà del
  // senso.
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta({ who: 'sathya@esempio.it' })] });
  const chi = page.locator('#mgMergeApprovals .sn-mac-who');
  await expect(chi).toBeVisible({ timeout: 8_000 });
  await expect(chi).toHaveText('chiesta da sathya@esempio.it');
});

test('una richiesta senza email non stampa un identificativo tecnico', async ({ openTab }) => {
  // Una stringa opaca non dice niente a chi deve decidere: si dice cosa
  // significa, non la si mostra.
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta({ who: 'K3nD9xQw1aZ7mB2pL0rT' })] });
  const chi = page.locator('#mgMergeApprovals .sn-mac-who');
  await expect(chi).toBeVisible({ timeout: 8_000 });
  await expect(chi).toContainText(/senza email/i);
  await expect(page.locator('#mgMergeApprovals .sn-mac')).not.toContainText('K3nD9xQw1aZ7mB2pL0rT');
});

// ── 1 bis. Una pagina GIÀ APERTA se ne accorge ──────────────────────────────
//
// Il guasto vero, e ci si è cascati subito: il terminale dice "approvala da
// Filo", ma la pagina leggeva l'elenco solo all'apertura. Con la pagina già
// aperta non compariva niente finché non se ne apriva una nuova.

test('la Gestione già aperta vede arrivare una richiesta nuova, senza riaprire niente', async ({ app, openTab }) => {
  const page = await openTab(MANAGE);
  // La situazione vera: pagina aperta da un pezzo, niente in sospeso.
  await apriGestione(page, { pending: [] });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();

  // …e adesso una fusione viene bloccata dai controlli. Nessuno tocca questa
  // pagina: è il main ad avvisarla.
  await avvisaDalMain(app, { pending: [richiesta()] });

  const avviso = page.locator('#mgMergeApprovals .sn-mac');
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await expect(avviso).toContainText('claude/approvazione-fusioni');
  await expect(avviso).toContainText('Tocca aree protette');
});

test('e sparisce da sola quando la richiesta non c’è più', async ({ app, openTab }) => {
  // L'owner può averla decisa da un'altra finestra: un avviso che resta lì
  // dopo che non c'è più niente da approvare fa cliccare a vuoto.
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta()] });
  await expect(page.locator('#mgMergeApprovals .sn-mac')).toBeVisible({ timeout: 8_000 });

  await avvisaDalMain(app, { pending: [] });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden({ timeout: 8_000 });
});

// ── 2. Solo i Ricevuti: le altre schede non lo mostrano ─────────────────────

test('l’avviso vive nei Ricevuti: cambiando scheda sparisce, tornando ricompare', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta()] });
  await expect(page.locator('#mgMergeApprovals .sn-mac')).toBeVisible({ timeout: 8_000 });

  // "In coda" condivide lo stesso pannello dei Ricevuti: è il caso che il
  // solo display del pannello non copre — senza la regola sulla scheda,
  // l'avviso resterebbe lì.
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();

  // Automazioni ha un pannello suo: l'avviso da decidere non c'è nemmeno lì
  // (resta la traccia delle decisioni passate, che è un'altra cosa).
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#mgMergeApprovals .sn-mac')).not.toBeVisible();

  // Tornando sui Ricevuti ricompare, senza dover ricaricare niente.
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('#mgMergeApprovals .sn-mac')).toBeVisible();
});

test('senza richieste non compare niente', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [] });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
  await expect(page.locator('.sn-mac')).toHaveCount(0);
});

// ── 3. La prima schermata non la mostra più ─────────────────────────────────

test('la home NON mostra l’avviso, nemmeno se il main avvisa', async ({ app, openTab }) => {
  // Scelta owner 2026-08-26: la home di tutti i giorni non è il posto delle
  // pratiche dell'owner — la decisione vive nei Ricevuti della Gestione.
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await avvisaDalMain(app, { pending: [richiesta()] });
  // Un attimo per essere sicuri che l'avviso sia stato consegnato e ignorato.
  await page.waitForTimeout(500);
  await expect(page.locator('#mergeApprovals')).toHaveCount(0);
  await expect(page.locator('.sn-mac')).toHaveCount(0);
});

// ── 4. Un utente qualunque non la vede, e il main gli dice di no ────────────

test('un utente normale non vede l’avviso, nemmeno se il server avesse qualcosa', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  // `admin:false` → la lettura risponde "riservato", come fa il main vero.
  await apriGestione(page, { admin: false, pending: [richiesta()] });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
  await expect(page.locator('.sn-mac')).toHaveCount(0);
});

test('il main rifiuta lettura, approvazione e scarto a chi non è il proprietario', async ({ openTab }) => {
  // Nessuno stub: è il gate VERO. Su userData pulito non c'è nessuna sessione,
  // quindi questo è esattamente ciò che vede un utente qualunque.
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  for (const type of ['merge_approvals_get', 'merge_approval_approve', 'merge_approval_discard']) {
    const r = await page.evaluate((t) => window.filo.message({ type: t, id: 'ab12cd34ef56ab12cd34ef56' }), type);
    expect(r, type).toBeTruthy();
    expect(r.ok, type).toBe(false);
    expect(String(r.error || ''), type).toMatch(/amministrator/i);
  }
});

test('una pagina web NON può chiedere se c’è una fusione in attesa, né approvarla', async ({ app, shell }) => {
  // Il canale dei messaggi è UNO solo e ci arrivano anche i content script dei
  // siti visitati. Senza il gate d'origine, un sito saprebbe su cosa sta
  // lavorando l'owner (il nome del ramo, i file toccati) e potrebbe tentare di
  // far approvare una fusione mentre lui guarda altrove — cioè esattamente la
  // cosa che questa superficie esiste per impedire.
  void shell; // attende il boot: SN_HANDLE_MESSAGE dev'essere montato
  const out = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const web = { url: 'https://sito-ostile.example/pagina' };
    const send = (type) => globalThis.SN_HANDLE_MESSAGE({ type, id: 'ab12cd34ef56ab12cd34ef56' }, web);
    return {
      get: await send(MSG.MERGE_APPROVALS_GET),
      approve: await send(MSG.MERGE_APPROVAL_APPROVE),
      discard: await send(MSG.MERGE_APPROVAL_DISCARD),
    };
  });
  expect(out.get).toEqual({ ok: false, error: 'forbidden' });
  expect(out.approve).toEqual({ ok: false, error: 'forbidden' });
  expect(out.discard).toEqual({ ok: false, error: 'forbidden' });
});

test('l’avviso NON arriva alle schede su siti qualunque', async ({ app, openTab, testServer }) => {
  // Il messaggio porta nomi di rami e percorsi di file: dice su cosa sta
  // lavorando l'owner. È la stessa regola del gate d'origine sugli handler,
  // vista dal verso opposto — se un sito non lo può chiedere, non glielo si
  // manda nemmeno da soli.
  await openTab(MANAGE);
  await testServer.openReady(openTab, '<html><body><p>sito qualunque</p></body></html>');

  const conteggi = await app.evaluate(({ BrowserWindow }) => {
    const spie = [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win._filoTabs) continue;
      for (const t of win._filoTabs.tabs) {
        const wc = t.view.webContents;
        const spia = { url: String(wc.getURL() || ''), n: 0 };
        const orig = wc.send.bind(wc);
        wc.send = (...a) => { spia.n++; return orig(...a); };
        spie.push(spia);
      }
    }
    globalThis.SN_BROADCAST_FILO({ type: 'merge_approvals_changed', pending: [], recent: [] });
    return spie.map((s) => ({ url: s.url, n: s.n }));
  });

  const filo = conteggi.filter((c) => c.url.startsWith('filo://'));
  const web = conteggi.filter((c) => c.url.startsWith('http://'));
  expect(filo.length, 'serve almeno una pagina filo:// aperta').toBeGreaterThan(0);
  expect(web.length, 'serve almeno una scheda su un sito qualunque').toBeGreaterThan(0);
  for (const c of filo) expect(c.n, c.url).toBeGreaterThan(0);
  for (const c of web) expect(c.n, c.url).toBe(0);
});

// ── 5. Approvare e scartare ─────────────────────────────────────────────────

test('approvare chiede conferma sul posto, e il gesto arriva al main', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta()] });

  const btn = page.locator('#mgMergeApprovals .sn-mac-btn-go');
  await expect(btn).toBeVisible({ timeout: 8_000 });

  // Irreversibile → il primo click NON manda niente: chiede conferma sul posto.
  await btn.click();
  await expect(btn).toHaveText('Confermi?');
  expect(await page.evaluate(() => window.__macCalls), 'primo click').toEqual([]);

  await btn.click();
  // L'esito che conta per l'owner: il codice è su main.
  await expect(page.locator('#mgMergeApprovals .sn-mac-status')).toContainText(/su main/i, { timeout: 8_000 });
  const calls = await page.evaluate(() => window.__macCalls);
  expect(calls).toEqual([{ op: 'approve', id: 'ab12cd34ef56ab12cd34ef56' }]);
});

test('scartare va dritto, e non fonde niente', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, { pending: [richiesta()] });

  await page.locator('#mgMergeApprovals .sn-mac-btn-quiet').click();
  await expect.poll(() => page.evaluate(() => window.__macCalls), { timeout: 8_000 })
    .toEqual([{ op: 'discard', id: 'ab12cd34ef56ab12cd34ef56' }]);
  expect((await page.evaluate(() => window.__macCalls)).some((c) => c.op === 'approve')).toBe(false);
});

// ── Gli esiti che non sono "fatto" ──────────────────────────────────────────

test('se il ramo è andato avanti l’avviso lo dice, e non finge di aver pubblicato', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, {
    pending: [richiesta()],
    approveReply: { ok: true, result: 'stale', headSha: 'ff'.repeat(20) },
  });
  const btn = page.locator('#mgMergeApprovals .sn-mac-btn-go');
  await btn.click();
  await btn.click();
  const status = page.locator('#mgMergeApprovals .sn-mac-status');
  await expect(status).toContainText(/andato avanti/i, { timeout: 8_000 });
  await expect(status).toContainText(/npm run finish/);
  await expect(status).not.toContainText(/su main/);
});

test('un guasto del server non diventa un “fatto”: si dice, e la richiesta resta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, {
    pending: [richiesta()],
    approveReply: { ok: false, error: 'callable ownerMergeApprovals 500: github_unreachable' },
  });
  const btn = page.locator('#mgMergeApprovals .sn-mac-btn-go');
  await btn.click();
  await btn.click();
  await expect(page.locator('#mgMergeApprovals .sn-mac-status')).toContainText(/non raggiungibile/i, { timeout: 8_000 });
  // La richiesta è ancora lì: si può riprovare senza rifare i controlli.
  await expect(page.locator('#mgMergeApprovals .sn-mac-card')).toHaveCount(1);
  await expect(btn).toBeEnabled();
});

// ── La traccia delle decisioni passate (Automazioni) ────────────────────────

test('Automazioni elenca le decisioni già prese: un’eccezione deve lasciare traccia', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriAutomazioni(page, {
    pending: [],
    recent: [
      richiesta({ id: '11'.repeat(12), used: true, outcome: 'merged', decidedAtMs: Date.now() - 3 * 60 * 1000 }),
      richiesta({ id: '22'.repeat(12), branch: 'claude/scartato', discarded: true, decidedAtMs: Date.now() - 9 * 60 * 1000 }),
    ],
  });
  const recenti = page.locator('#mgMergeApprovalsRecent');
  await expect(recenti).toBeVisible({ timeout: 8_000 });
  await expect(recenti).toContainText('approvata e fusa');
  await expect(recenti).toContainText('scartata');
  await expect(recenti).toContainText('claude/scartato');
  // Chi, cosa, quando: senza il "chi" la traccia risponde a due domande su tre.
  await expect(recenti).toContainText('chiesta da owner@esempio');
});

// ── 6. Le due provenienze, e il legame con la segnalazione ──────────────────
//
// Il blocco di sicurezza ferma sia il lavoro locale sia quello di
// un'automazione. Finiscono nello stesso elenco, ma non sono la stessa cosa da
// approvare: il lavoro di un'automazione nasce dal testo di uno sconosciuto, e
// la scheda deve dire quale segnalazione era — con un click per aprirla, visto
// che l'avviso vive già dentro la dashboard dei feedback.

test('una fusione fermata a un’automazione si riconosce da quella locale', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, {
    pending: [
      richiesta({ id: 'aa11bb22cc33aa11bb22cc33', origin: 'routine', num: '412', who: 'secaudit · notturna', branch: 'claude/feedback-412' }),
      richiesta({ id: 'bb22cc33dd44bb22cc33dd44', origin: 'locale', who: 'sathya@esempio.it' }),
    ],
  });

  const automazione = page.locator('#mgMergeApprovals .sn-mac-card[data-origin="routine"]');
  const locale = page.locator('#mgMergeApprovals .sn-mac-card[data-origin="locale"]');
  await expect(automazione).toBeVisible({ timeout: 8_000 });
  await expect(locale).toBeVisible();

  // La provenienza si legge sulla scheda, e porta al numero della segnalazione.
  await expect(automazione.locator('.sn-mac-origin')).toContainText(/automazione/i);
  await expect(automazione.locator('.sn-mac-origin')).toContainText('#412');
  await expect(locale.locator('.sn-mac-origin')).not.toContainText(/automazione/i);

  // …e si approva da lì, come quella locale: è il punto di tutta la modifica.
  await automazione.locator('.sn-mac-btn-go').click();
  await automazione.locator('.sn-mac-btn-go').click();
  await expect
    .poll(() => page.evaluate(() => window.__macCalls), { timeout: 8_000 })
    .toEqual([{ op: 'approve', id: 'aa11bb22cc33aa11bb22cc33' }]);
});

test('il numero della segnalazione si stampa con UN cancelletto, comunque arrivi', async ({ openTab }) => {
  // Il server manda `num` a volte già con il `#` davanti: la richiesta vera
  // del 2026-08-26 stampava "feedback ##444".
  const page = await openTab(MANAGE);
  await apriGestione(page, {
    pending: [richiesta({ origin: 'routine', num: '#444', who: 'secaudit · notturna' })],
  });
  const origin = page.locator('#mgMergeApprovals .sn-mac-origin');
  await expect(origin).toBeVisible({ timeout: 8_000 });
  await expect(origin).toContainText('feedback #444');
  await expect(origin).not.toContainText('##');
});

test('il numero della segnalazione è un click: apre il feedback da cui nasce il lavoro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriGestione(page, {
    pending: [richiesta({ origin: 'routine', num: '#412', who: 'secaudit · notturna' })],
  });
  // La segnalazione #412 esiste nella lista dei Ricevuti.
  await page.evaluate(() => window.__mgTest.setData([{
    _id: 'test-fb-412',
    text: 'Il menu della copertina perde metà delle voci.',
    name: 'Menu copertina',
    seq: 412,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-08-20T10:00:00Z',
    images: [],
  }]));

  const origin = page.locator('#mgMergeApprovals button.sn-mac-origin-link');
  await expect(origin).toBeVisible({ timeout: 8_000 });
  await origin.click();

  // Il dettaglio del feedback #412 è aperto: "guarda cosa era stato chiesto"
  // è un click, non una ricerca a mano.
  await expect(page.locator('#mgDetail')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.mg-item--selected')).toContainText('#412');
});

test('una richiesta di un’automazione non manda l’owner a lanciare la pubblicazione locale', async ({ openTab }) => {
  // Il consiglio sbagliato è peggio di nessun consiglio: quel comando pubblica
  // il lavoro di QUESTO computer, e non c'entra niente con un ramo scritto da
  // un'automazione.
  const page = await openTab(MANAGE);
  await apriGestione(page, {
    pending: [richiesta({ origin: 'routine', num: '412' })],
    approveReply: { ok: true, result: 'stale', headSha: 'f'.repeat(40) },
  });

  const card = page.locator('#mgMergeApprovals .sn-mac-card');
  await expect(card).toBeVisible({ timeout: 8_000 });
  await card.locator('.sn-mac-btn-go').click();
  await card.locator('.sn-mac-btn-go').click();

  const esito = card.locator('.sn-mac-status');
  await expect(esito).toBeVisible({ timeout: 8_000 });
  await expect(esito).not.toContainText('npm run finish');
});

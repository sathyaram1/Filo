// L'AVVISO DELLE FUSIONI IN ATTESA — SPEC-RIDISEGNO-MAX.md §10.
//
// COSA DEVE ESSERE VERO
//   I controlli deterministici del server fermano le fusioni che toccano le
//   aree protette. Il lavoro locale dell'owner ci cade dentro quasi sempre, e
//   senza una superficie dove approvarlo non avrebbe nessuna strada verso il
//   ramo principale. Quella superficie deve rispettare quattro cose:
//
//     1. l'owner con una richiesta in attesa la trova nella PRIMA SCHERMATA,
//        senza cercarla;
//     2. l'owner SENZA richieste non vede niente (la home non si rovina per
//        una cosa che non c'è) — e la griglia resta quella di prima;
//     3. un utente qualunque non la vede MAI, e il main gli risponde di no
//        anche se prova a chiamare il comando a mano;
//     4. i due cammini — prima schermata e Gestione → Automazioni — fanno la
//        STESSA cosa: stesse informazioni, stessi bottoni, stesso effetto.
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
    expiresAtMs: Date.now() + 28 * 60 * 1000,
    expired: false,
    used: false,
    discarded: false,
  }, over);
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
        return { ok: true, pending: cfg.pending, recent: cfg.recent, ttlMs: 30 * 60 * 1000 };
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

async function apriHome(page, opts) {
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await page.waitForFunction(() => !!window.__filoDashActions);
  await stubApprovals(page, opts);
  // Il cammino vero: prima "chi sono", poi "cosa c'è in attesa".
  await page.evaluate(() => window.__filoDashActions.refreshAccountControl());
}

async function apriAutomazioni(page, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubApprovals(page, opts);
  await page.evaluate((admin) => window.__mgTest.setAdmin(admin), opts?.admin !== false);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate(() => window.__mgTest.loadMergeApprovals());
}

// ── 1. L'owner la trova nella prima schermata ───────────────────────────────

test('prima schermata: con una fusione in attesa l’avviso c’è, e dice ramo, commit e perché', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriHome(page, { pending: [richiesta()] });

  const avviso = page.locator('#mergeApprovals .sn-mac');
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await expect(avviso).toContainText('Una fusione aspetta il tuo via libera');
  await expect(avviso).toContainText('claude/approvazione-fusioni');
  await expect(avviso).toContainText(SHA.slice(0, 8));
  // I motivi del blocco in parole dell'owner: senza, "approva" è un sì al buio.
  await expect(avviso).toContainText('Tocca aree protette');
  await expect(avviso).toContainText('firestore.rules');
  await expect(avviso).toContainText('Cambia le dipendenze del progetto');
  // La scadenza si dice PRIMA, non premendo il bottone.
  await expect(avviso.locator('.sn-mac-expiry')).toContainText(/scade fra/);

  // L'avviso occupa una riga sua in cima: la home non gli si accavalla.
  const box = await avviso.boundingBox();
  const centro = await page.locator('#center').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(centro.y + 1);
});

test('prima schermata: due richieste = due schede, e il titolo lo dice', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriHome(page, {
    pending: [richiesta(), richiesta({ id: 'ff'.repeat(12), branch: 'claude/altro' })],
  });
  await expect(page.locator('#mergeApprovals .sn-mac-card')).toHaveCount(2);
  await expect(page.locator('#mergeApprovals .sn-mac')).toContainText('2 fusioni aspettano');
});

// ── 2. Niente in attesa = niente avviso ─────────────────────────────────────

test('prima schermata: senza richieste non compare NIENTE, e la griglia resta quella di prima', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  // Prima com'è la home quando non c'è nulla…
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  const senza = await page.locator('#center').boundingBox();

  await apriHome(page, { pending: [] });
  await expect(page.locator('#mergeApprovals')).toBeHidden();
  await expect(page.locator('.sn-mac')).toHaveCount(0);
  // …e dopo. La riga in più non deve esistere: se la griglia guadagnasse una
  // traccia vuota, tutta la home scenderebbe anche per chi non ha niente.
  await expect(page.locator('#dash')).not.toHaveClass(/dash--notice/);
  const dopo = await page.locator('#center').boundingBox();
  expect(Math.abs(dopo.y - senza.y)).toBeLessThan(2);
});

// ── 3. Un utente qualunque non la vede, e il main gli dice di no ────────────

test('un utente normale non vede l’avviso, nemmeno se il server avesse qualcosa', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  // `admin:false` → la lettura risponde "riservato", come fa il main vero.
  await apriHome(page, { admin: false, pending: [richiesta()] });
  await expect(page.locator('#mergeApprovals')).toBeHidden();
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

test('una pagina web NON può chiedere se c’è una fusione in attesa, né approvarla', async ({ openTab, testServer }) => {
  // Il canale dei messaggi è uno solo: senza il gate d'origine, un sito
  // visitato saprebbe su cosa sta lavorando l'owner e potrebbe tentare di far
  // approvare una fusione mentre lui guarda altrove.
  const page = await openTab(`${testServer.url}/`);
  await page.waitForLoadState('domcontentloaded');
  for (const type of ['merge_approvals_get', 'merge_approval_approve', 'merge_approval_discard']) {
    const r = await page.evaluate((t) => window.filo?.message?.({ type: t, id: 'ab12cd34ef56ab12cd34ef56' })
      ?? window.chrome?.runtime?.sendMessage?.({ type: t }), type);
    expect(r, type).toBeTruthy();
    expect(r.ok, type).toBe(false);
    expect(String(r.error || ''), type).toBe('forbidden');
  }
});

// ── 4. I due cammini fanno la stessa cosa ───────────────────────────────────

test('Gestione → Automazioni mostra la STESSA cosa della prima schermata', async ({ openTab }) => {
  const home = await openTab(NEWTAB);
  await apriHome(home, { pending: [richiesta()] });
  const testoHome = await home.locator('#mergeApprovals .sn-mac').innerText();

  const manage = await openTab(MANAGE);
  await apriAutomazioni(manage, { pending: [richiesta()] });
  const avviso = manage.locator('#mgMergeApprovals .sn-mac');
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  const testoManage = await avviso.innerText();

  // Stesso modulo, stesso foglio di stile: il testo deve coincidere. Se un
  // giorno una delle due superfici imparasse qualcosa che l'altra non sa,
  // questo assert diventa rosso.
  expect(testoManage).toBe(testoHome);
});

test('Gestione → Automazioni: senza richieste il blocco non c’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriAutomazioni(page, { pending: [] });
  await expect(page.locator('#mgMergeApprovals')).toBeHidden();
  await expect(page.locator('.sn-mac')).toHaveCount(0);
});

test('approvare funziona da ENTRAMBI i cammini, con lo stesso effetto', async ({ openTab }) => {
  for (const [dove, url, host] of [
    ['prima schermata', NEWTAB, '#mergeApprovals'],
    ['Gestione', MANAGE, '#mgMergeApprovals'],
  ]) {
    const page = await openTab(url);
    if (url === NEWTAB) await apriHome(page, { pending: [richiesta()] });
    else await apriAutomazioni(page, { pending: [richiesta()] });

    const btn = page.locator(`${host} .sn-mac-btn-go`);
    await expect(btn).toBeVisible({ timeout: 8_000 });

    // Irreversibile → il primo click NON manda niente: chiede conferma sul posto.
    await btn.click();
    await expect(btn).toHaveText('Confermi?');
    expect(await page.evaluate(() => window.__macCalls), `${dove}: primo click`).toEqual([]);

    await btn.click();
    // L'esito che conta per l'owner: il codice è su main.
    await expect(page.locator(`${host} .sn-mac-status`)).toContainText(/su main/i, { timeout: 8_000 });
    const calls = await page.evaluate(() => window.__macCalls);
    expect(calls, dove).toEqual([{ op: 'approve', id: 'ab12cd34ef56ab12cd34ef56' }]);
  }
});

test('scartare funziona da ENTRAMBI i cammini, e non fonde niente', async ({ openTab }) => {
  for (const [dove, url, host] of [
    ['prima schermata', NEWTAB, '#mergeApprovals'],
    ['Gestione', MANAGE, '#mgMergeApprovals'],
  ]) {
    const page = await openTab(url);
    if (url === NEWTAB) await apriHome(page, { pending: [richiesta()] });
    else await apriAutomazioni(page, { pending: [richiesta()] });

    await page.locator(`${host} .sn-mac-btn-quiet`).click();
    await expect.poll(() => page.evaluate(() => window.__macCalls), { timeout: 8_000 })
      .toEqual([{ op: 'discard', id: 'ab12cd34ef56ab12cd34ef56' }]);
    expect((await page.evaluate(() => window.__macCalls)).some((c) => c.op === 'approve'), dove).toBe(false);
  }
});

// ── Gli esiti che non sono "fatto" ──────────────────────────────────────────

test('se il ramo è andato avanti l’avviso lo dice, e non finge di aver pubblicato', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriHome(page, {
    pending: [richiesta()],
    approveReply: { ok: true, result: 'stale', headSha: 'ff'.repeat(20) },
  });
  const btn = page.locator('#mergeApprovals .sn-mac-btn-go');
  await btn.click();
  await btn.click();
  const status = page.locator('#mergeApprovals .sn-mac-status');
  await expect(status).toContainText(/andato avanti/i, { timeout: 8_000 });
  await expect(status).toContainText(/npm run finish/);
  await expect(status).not.toContainText(/su main/);
});

test('un guasto del server non diventa un “fatto”: si dice, e la richiesta resta', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await apriHome(page, {
    pending: [richiesta()],
    approveReply: { ok: false, error: 'callable ownerMergeApprovals 500: github_unreachable' },
  });
  const btn = page.locator('#mergeApprovals .sn-mac-btn-go');
  await btn.click();
  await btn.click();
  await expect(page.locator('#mergeApprovals .sn-mac-status')).toContainText(/non raggiungibile/i, { timeout: 8_000 });
  // La richiesta è ancora lì: si può riprovare senza rifare i controlli.
  await expect(page.locator('#mergeApprovals .sn-mac-card')).toHaveCount(1);
  await expect(btn).toBeEnabled();
});

// ── La traccia delle decisioni passate (solo in Gestione) ───────────────────

test('Gestione elenca le decisioni già prese: un’eccezione deve lasciare traccia', async ({ openTab }) => {
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
  // La prima schermata NON la mostra: lì sarebbe rumore.
  const home = await openTab(NEWTAB);
  await apriHome(home, { pending: [], recent: [richiesta({ used: true, outcome: 'merged' })] });
  await expect(home.locator('#mergeApprovals')).toBeHidden();
});

// La pagina Feedback aperta segue da sola i cambi di stato fatti altrove, come la Gestione (#738): stesso
// giro, stessa regola delle sezioni (una richiesta di fusione in attesa porta la pratica nei Ricevuti anche
// con lo stato rimasto indietro), niente letture quando la pagina non è in vista, nessuna bozza persa.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://feedback/feedback.html';
const TEMPI = { pollMs: 400, rientroMs: 200, clockMs: 100 };

function fb(id, seq, status, extra = {}) {
  return {
    _id: id,
    _updateTime: 't1',
    updatedAt: '2026-09-01T10:00:00.000Z',
    seq,
    subSeq: 0,
    name: `Segnalazione ${seq}`,
    text: `Testo ${seq}`,
    status,
    statusReason: extra.statusReason || null,
    clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(),
    images: [],
    ...extra,
  };
}

function richiesta(feedbackId, num) {
  return {
    id: `req-${feedbackId}`, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num),
    who: 'secaudit · x', origin: 'routine', trips: [{ gate: 'rules', label: 'Regole', items: ['firestore.rules'] }],
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}

const tab = (page, t) => page.locator(`.fb-tab[data-tab="${t}"]`);
const scheda = (page, id) => page.locator(`.fb-card[data-id="${id}"]`);
const schede = (page) => page.locator('#list .fb-card').evaluateAll((els) => els.map((e) => e.dataset.id));

// ── Il cammino vero: Firestore finto NEL MAIN, la pagina e il giro sono quelli veri ─────────────────────
async function fingiFirestore(app, docs) {
  await app.evaluate(async (_electron, { docs, ritmo }) => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'token-finto';
    globalThis.__docs = docs;
    globalThis.__conta = { tutti: 0, cambiati: 0 };
    const C = globalThis.__conta;
    const FB = globalThis.SN_FEEDBACK;
    const copia = (d) => JSON.parse(JSON.stringify(d));
    FB.listAllPaged = async () => { C.tutti += 1; return { rows: globalThis.__docs.map(copia), complete: true, readTime: new Date().toISOString() }; };
    FB.listChangedSince = async ({ since }) => {
      C.cambiati += 1;
      return { rows: globalThis.__docs.filter((d) => d.updatedAt > since).map(copia), complete: true, readTime: new Date().toISOString() };
    };
    FB.versionsOf = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id)).map((d) => ({ _id: d._id, _updateTime: d._updateTime }));
    FB.getMany = async (ids) => globalThis.__docs.filter((d) => ids.includes(d._id)).map(copia);
    FB.submissionCount = async () => 1000;
    FB.idDelNumero = async () => null;
    FB.getManyPublic = async () => [];
    FB.listAllPublic = async () => [];
    FB.listResolved = async () => [];
    globalThis.__filoDefaults.getWorkerLog = async () => [];
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = ritmo;
  }, { docs, ritmo: TEMPI.pollMs });
}

async function ilServerScrive(app, id, campi) {
  await app.evaluate((_e, { id, campi }) => {
    const d = globalThis.__docs.find((x) => x._id === id);
    Object.assign(d, campi, { _updateTime: `${d._updateTime}+`, updatedAt: new Date().toISOString() });
  }, { id, campi });
}

test('un cambio di stato fatto altrove sposta la scheda di sezione senza ricaricare, e l\'arrivo si vede', async ({ app, openTab }) => {
  await fingiFirestore(app, [fb('fA', 101, 'todo'), fb('fB', 102, 'unlabeled')]);
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__fbTest && window.filo);
  await expect(tab(page, 'queue')).toHaveText('In coda (1)', { timeout: 15_000 });
  await page.evaluate((t) => { window.__nonRicaricata = true; window.__fbTest.setLiveTiming(t); }, TEMPI);
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)');
  await expect(scheda(page, 'fB')).toBeVisible();

  // Una routine ferma #101 al cancello: torna fra le decisioni dell'owner.
  await ilServerScrive(app, 'fA', { status: 'design', statusReason: 'l5' });
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (2)', { timeout: 8_000 });
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');
  await expect(scheda(page, 'fA')).toBeVisible();
  await expect(scheda(page, 'fA').locator('.fb-arrivo')).toHaveCount(1);
  await expect(tab(page, 'inbox')).toHaveClass(/fb-tab--arrivi/);
  expect(await page.evaluate(() => window.__nonRicaricata)).toBe(true);

  // Toccata, l'arrivo è visto: il punto se ne va anche dalla sezione.
  await scheda(page, 'fA').locator('.fb-title').click();
  await expect(scheda(page, 'fA').locator('.fb-arrivo')).toHaveCount(0);
  await expect(tab(page, 'inbox')).not.toHaveClass(/fb-tab--arrivi/);

  // Un'altra scheda davanti: il giro si ferma. Tornando, il cambio fatto nel frattempo arriva subito.
  const snap = await openTab('filo://newtab/');
  void snap;
  await page.waitForTimeout(TEMPI.pollMs * 2);
  const nascosta = await app.evaluate(() => globalThis.__conta.cambiati);
  await page.waitForTimeout(TEMPI.pollMs * 5);
  expect(await app.evaluate(() => globalThis.__conta.cambiati)).toBe(nascosta);
  await ilServerScrive(app, 'fB', { status: 'todo' });
  await page.evaluate(() => window.__fbTest.setLiveTiming({ pollMs: 10 * 60 * 1000 }));
  await page.bringToFront();
  await page.evaluate(() => window.filo.message({ type: 'tab_in_vista_get' }));
  const shellTabs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => String(x.view.webContents.getURL()).startsWith('filo://feedback'));
    w._filoTabs.activate(t.id);
    return t.id;
  });
  expect(shellTabs).toBeTruthy();
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)', { timeout: 4_000 });
  expect(await app.evaluate(() => globalThis.__conta.tutti)).toBe(1);
});

// ── La pagina con le sorgenti finte (come gli spec della Gestione) ───────────────────────────────────────
async function apri(openTab, docs, { pending = [] } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.filo && window.SN_FEEDBACK);
  await page.evaluate(({ docs, pending, tempi }) => {
    window.__nonRicaricata = true;
    window.__srv = { docs: {}, letture: 0, pending };
    for (const d of docs) window.__srv.docs[d._id] = d;
    const CAMPI = window.SN_FEEDBACK.CAMPI_LISTA;
    // Come Firestore con la proiezione della lista: niente conversazione, e il marchio che lo dice.
    const riga = (d) => {
      const r = { _proiezione: true, _id: d._id, _updateTime: d._updateTime };
      for (const k of CAMPI) if (k in d) r[k] = d[k];
      return r;
    };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (m) => {
      const t = m && m.type;
      if (t === 'merge_approvals_get') return { ok: true, pending: window.__srv.pending, failed: [], recent: [] };
      if (t === 'feedback_decrypt_fields') return { ok: true, list: m.list };
      return orig(m);
    };
    window.SN_FEEDBACK.getMany = async (ids) => ids.map((id) => window.__srv.docs[id]).filter(Boolean).map((d) => ({ ...d }));
    window.SN_FEEDBACK.listAllPaged = async () => ({ rows: Object.values(window.__srv.docs).map(riga), complete: true });
    window.__fbTest.setLiveSources({
      listVersions: async () => {
        window.__srv.letture += 1;
        return Object.values(window.__srv.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime }));
      },
      getMany: async (ids) => ids.map((id) => window.__srv.docs[id]).filter(Boolean).map(riga),
    });
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setLiveTiming(tempi);
    window.__fbTest.setData(Object.values(window.__srv.docs).map(riga), { dalVivo: true });
  }, { docs, pending, tempi: TEMPI });
  return page;
}

async function scrive(page, id, campi) {
  await page.evaluate(({ id, campi }) => {
    const d = window.__srv.docs[id];
    window.__srv.docs[id] = { ...d, ...campi, _updateTime: `${d._updateTime}+` };
  }, { id, campi });
}

// Il campanello del main: una fusione fermata altrove arriva alle pagine aperte con l'elenco nuovo.
async function suonaFusioni(app, pending) {
  await app.evaluate(({ BrowserWindow }, pending) => {
    const msg = { type: 'merge_approvals_changed', pending, failed: [], recent: [] };
    for (const win of BrowserWindow.getAllWindows()) {
      for (const t of (win._filoTabs && win._filoTabs.tabs) || []) {
        try { t.view.webContents.send('filo:broadcast', msg); } catch (_) { /* scheda chiusa */ }
      }
    }
  }, pending);
}

test('una richiesta di fusione in attesa porta la pratica nei Ricevuti anche con lo stato rimasto indietro', async ({ openTab }) => {
  const page = await apri(openTab, [fb('f515', 515, 'working', { workingSince: new Date().toISOString() }), fb('f600', 600, 'unlabeled')],
    { pending: [richiesta('f515', 515)] });
  // All'apertura (qui: Aggiorna) la pagina legge anche le fusioni, come la Gestione.
  await page.locator('#refresh').click();
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (2)');
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');
  await expect(scheda(page, 'f515').locator('.fb-fusione')).toHaveText('fusione ferma');
});

test('la richiesta che arriva (o se ne va) a pagina aperta sposta la pratica, e un giro che muove lo stato rilegge le fusioni', async ({ app, openTab }) => {
  const page = await apri(openTab, [fb('f515', 515, 'revision_security'), fb('f600', 600, 'unlabeled')]);
  await expect(tab(page, 'queue')).toHaveText('In coda (1)');

  await page.evaluate((r) => { window.__srv.pending = [r]; }, richiesta('f515', 515));
  await suonaFusioni(app, [richiesta('f515', 515)]);
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (2)', { timeout: 5_000 });
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');
  await expect(scheda(page, 'f515').locator('.fb-arrivo')).toHaveCount(1);
  await expect(scheda(page, 'f515').locator('.fb-fusione')).toBeVisible();

  // Fusa sul server: la richiesta sparisce e lo stato si muove. Il giro lo porta, e con lui rilegge le fusioni.
  await page.evaluate(() => { window.__srv.pending = []; });
  await scrive(page, 'f515', { status: 'done', resolvedInVersion: '' });
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)', { timeout: 8_000 });
  await expect(scheda(page, 'f515')).toHaveCount(0);
  expect(await page.evaluate(() => window.__nonRicaricata)).toBe(true);
});

test('un giro non porta via la risposta che si sta scrivendo, e dopo arriva lo stesso', async ({ openTab }) => {
  const page = await apri(openTab, [
    fb('f700', 700, 'design', { statusReason: 'clarify', notes: 'Domanda di Filo: quale pagina?' }),
    fb('f701', 701, 'unlabeled'),
  ]);
  const risposta = scheda(page, 'f700').locator('.fb-reply-text');
  await risposta.fill('Risposta a metà');
  // Il cursore va altrove, la bozza resta nella casella.
  await page.locator('#search').focus();

  await scrive(page, 'f701', { status: 'todo' });
  await expect(tab(page, 'queue')).toHaveText('In coda (1)', { timeout: 5_000 });
  // I numeri dicono subito la verità; la lista aspetta la bozza.
  await page.waitForTimeout(TEMPI.pollMs * 3);
  await expect(scheda(page, 'f701')).toHaveCount(1);
  await expect(risposta).toHaveValue('Risposta a metà');

  // Bozza svuotata: il ridisegno trattenuto parte da sé.
  await risposta.fill('');
  await page.locator('#search').focus();
  await expect(scheda(page, 'f701')).toHaveCount(0, { timeout: 5_000 });
});

test('una conversazione cambiata insieme allo stato arriva intera, senza «Caricamento…» al posto della lista', async ({ openTab }) => {
  const page = await apri(openTab, [
    fb('f800', 800, 'unlabeled', { notes: '' }),
    fb('f801', 801, 'todo', { notes: 'Prima nota' }),
  ]);
  await expect(scheda(page, 'f800')).toBeVisible();
  await page.evaluate(() => {
    window.__vistoCaricamento = false;
    new MutationObserver(() => {
      if (/Caricamento/.test(document.getElementById('list').textContent || '')) window.__vistoCaricamento = true;
    }).observe(document.getElementById('list'), { childList: true, subtree: true, characterData: true });
  });

  // Una routine chiede chiarimenti su #801: torna nei Ricevuti con la domanda nella conversazione.
  await scrive(page, 'f801', {
    status: 'design', statusReason: 'clarify',
    notes: 'Prima nota\n\n--- Filo · 05/10/2026 ---\nDomanda nuova: quale pagina?',
  });
  await expect(scheda(page, 'f801')).toBeVisible({ timeout: 8_000 });
  await expect(scheda(page, 'f801')).toContainText('Domanda nuova: quale pagina?');
  expect(await page.evaluate(() => window.__vistoCaricamento)).toBe(false);
});

test('il ridisegno tiene lo scorrimento sulla scheda che si stava leggendo', async ({ openTab }) => {
  const docs = [];
  for (let n = 760; n > 730; n -= 1) docs.push(fb(`f${n}`, n, 'unlabeled', { text: `Testo ${n}\n`.repeat(4) }));
  const page = await apri(openTab, docs);
  await expect(page.locator('#list .fb-card')).toHaveCount(30);
  const primaVisibile = () => page.evaluate(() => [...document.querySelectorAll('#list .fb-card')]
    .find((el) => el.getBoundingClientRect().bottom > 1)?.dataset.id);
  await page.evaluate(() => document.querySelector('.fb-card[data-id="f745"]').scrollIntoView({ block: 'start' }));
  expect(await primaVisibile()).toBe('f745');
  const ordine = await schede(page);
  expect(ordine.indexOf('f750')).toBeLessThan(ordine.indexOf('f745'));

  // Esce una scheda più su: la vista non salta.
  await page.mouse.move(5, 5);
  await scrive(page, 'f750', { status: 'todo' });
  await expect(scheda(page, 'f750')).toHaveCount(0, { timeout: 8_000 });
  expect(await primaVisibile()).toBe('f745');
});

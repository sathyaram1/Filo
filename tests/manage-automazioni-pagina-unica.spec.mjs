// Gestione → Automazioni è UNA pagina per tutte le impostazioni dell'owner, Modelli di supporto compresi, e
// usa tutta la larghezza; la traccia delle fusioni decise sta nel Log, non sopra le impostazioni (#1110).
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const SHA = 'a1b2c3d4'.repeat(5);

const MODELLI = {
  sanitizer: 'flash', judge1: 'flash, flash-or', judge2: 'flash', judge3: 'flash',
  judgeDynamic: 'flash', judgeRedTeam: 'flash', judgePriority: 'flash', manageSearch: 'flash',
  judgeRegistry: { flash: { model: 'deepseek/deepseek-v4-flash' }, 'flash-or': { model: 'deepseek/deepseek-v4-pro' } },
  openrouterKeyPresent: true, judgeTimeoutMs: 60000,
};

function fusa(i) {
  return {
    id: String(i).padStart(24, 'a'), branch: `worker/lavoro-${i}`, sha: SHA, mergeSha: SHA,
    who: 'secaudit · notturna', origin: 'routine', num: `#${600 + i}`, feedbackId: `f${i}`,
    blocks: [{ gate: 'guard_the_guards', label: 'Tocca aree protette', items: ['firestore.rules', 'scripts/lib/a.mjs'], more: 0 }],
    createdAtMs: Date.now() - i * 3600e3, decidedAtMs: Date.now() - i * 3600e3, used: true, outcome: 'merged',
    preapproved: true, preapprovedBy: 'owner@esempio', preapprovedAt: '2026-09-13T08:00:00.000Z',
  };
}
// Abbastanza storia da riempire più di uno schermo: era quella a spingere giù le impostazioni.
const STORIA = Array.from({ length: 8 }, (_, i) => fusa(i));

async function apri(app, openTab, { admin = true, recent = STORIA.slice(0, 6), preapproved = STORIA, size = [1536, 864] } = {}) {
  const page = await openTab(URL);
  // La finestra con le schede, non la prima: il menu a comparsa ha una finestra sua, pronta dall'avvio.
  await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs).setSize(s[0], s[1]); }, size);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((cfg) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: cfg.admin, isAdmin: cfg.admin, profile: null };
      if (!cfg.admin && /^(support_models_get|merge_approvals_get|automation_)/.test(t || '')) return { ok: false, error: 'riservato' };
      if (t === 'support_models_get') return { ok: true, models: cfg.modelli };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: cfg.recent, preapproved: cfg.preapproved, ttlMs: 7 * 864e5 };
      if (t === 'automation_get') return { ok: true, enabled: true, routinesEnabled: true, autoApprove: {} };
      if (t === 'automation_caps_get') return { ok: true, cap3: 3, cap2: 2, cap1: 1, cap0: 0, fixInstructions: '', giroStretto: true };
      if (t === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: 4, priorityAccount: '', accountAOff: false, accountBOff: false };
      return orig(msg);
    };
  }, { admin, recent, preapproved, modelli: MODELLI });
  await page.evaluate((a) => window.__mgTest.setAdmin(a), admin);
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => Promise.all([window.__mgTest.loadMergeApprovals(), window.__mgTest.loadSessions()]));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(size[0] - 40);
  return page;
}

test('Automazioni: impostazioni e modelli di supporto in una pagina sola, subito a schermo e su tutta la larghezza', async ({ app, openTab }) => {
  const page = await apri(app, openTab);

  // La scheda a parte non c'è più: si modifica tutto da qui.
  await expect(page.locator('.mg-tab[data-tab="models"]')).toHaveCount(0);
  await apriScheda(page, 'automation');
  const pannello = page.locator('#panel-automation');
  await expect(pannello.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });
  await expect(pannello.locator('#mgSmChain-judge1 .sn-chain-input')).toHaveCount(2);
  await expect(pannello.locator('#mgRoutinesToggle')).toBeChecked();
  await expect(page.locator('#mgMaxSessions')).toHaveValue('4');

  // La storia delle fusioni non sta qui, anche con otto fusioni in archivio.
  await expect(pannello.locator('#mgMergeApprovalsRecent, #mgMergeApprovalsPreapproved, .sn-mac-recent-title')).toHaveCount(0);

  // Senza scorrere: la prima impostazione e i primi modelli sono già nella finestra.
  const vista = await page.evaluate(() => {
    document.documentElement.scrollTop = 0;
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      w: window.innerWidth, h: window.innerHeight,
      routine: r('#mgRoutinesSwitch'), chiave: r('#mgSmKeyOpenrouter'), cap3: r('#mgCap3'),
      colonne: Array.from(document.querySelectorAll('#panel-automation .mg-auto-col')).map((c) => c.getBoundingClientRect()),
      modelli: r('#mgSmSection'), principale: r('#panel-automation .mg-auto-main'),
      sbordo: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  for (const k of ['routine', 'chiave', 'cap3']) expect(vista[k].bottom, k).toBeLessThan(vista.h);

  // Tutta la larghezza: due colonne di impostazioni affiancate e i modelli a destra, fino al bordo.
  expect(vista.colonne).toHaveLength(2);
  expect(vista.colonne[1].left).toBeGreaterThan(vista.colonne[0].right);
  expect(vista.modelli.left).toBeGreaterThan(vista.colonne[1].right);
  expect(Math.abs(vista.modelli.top - vista.principale.top)).toBeLessThan(4);
  expect(vista.modelli.right).toBeGreaterThan(vista.w - 60);
  expect(vista.sbordo).toBe(false);
  await page.screenshot({ path: 'tests/.shots/1110-automazioni.png' });

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/1110-automazioni-scuro.png' });
});

test('finestra stretta: la stessa pagina va in colonna, senza sbordare', async ({ app, openTab }) => {
  const page = await apri(app, openTab, { size: [820, 800] });
  await apriScheda(page, 'automation');
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });
  const r = await page.evaluate(() => ({
    sbordo: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    principale: document.querySelector('#panel-automation .mg-auto-main').getBoundingClientRect().bottom,
    modelli: document.querySelector('#mgSmSection').getBoundingClientRect().top,
  }));
  expect(r.sbordo).toBe(false);
  expect(r.modelli).toBeGreaterThanOrEqual(r.principale);
});

test('la storia delle fusioni decise si rilegge nel Log, con tutto quello che era stato segnalato', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await apriScheda(page, 'log');
  const sezione = page.locator('#panel-log #mgFusioniSection');
  await expect(sezione).toBeVisible();
  await expect(sezione.locator('#mgMergeApprovalsRecent')).toContainText('Decise di recente');
  await expect(sezione.locator('#mgMergeApprovalsRecent .sn-mac-recent-row')).toHaveCount(6);
  await expect(sezione.locator('#mgMergeApprovalsPreapproved')).toContainText('Fuse senza chiedere');
  await expect(sezione.locator('#mgMergeApprovalsPreapproved .sn-mac-preapproved-row')).toHaveCount(8);
  await expect(sezione.locator('#mgMergeApprovalsPreapproved')).toContainText('scripts/lib/a.mjs');
  await expect(page.locator('#mgFusioniEmpty')).toBeHidden();

  // Affiancata al log dei worker, non in coda: su uno schermo largo si vedono insieme.
  const [worker, fusioni] = await page.evaluate(() => Array.from(document.querySelectorAll('#panel-log .mg-log-col'))
    .map((c) => c.getBoundingClientRect().toJSON()));
  expect(fusioni.left).toBeGreaterThan(worker.right);
  expect(Math.abs(fusioni.top - worker.top)).toBeLessThan(4);
  await page.screenshot({ path: 'tests/.shots/1110-log.png' });
});

test('Log senza fusioni decise lo dice; da non owner la colonna non c’è', async ({ app, openTab }) => {
  const page = await apri(app, openTab, { recent: [], preapproved: [] });
  await apriScheda(page, 'log');
  await expect(page.locator('#mgFusioniSection')).toBeVisible();
  await expect(page.locator('#mgFusioniEmpty')).toBeVisible();
  await expect(page.locator('#mgFusioniEmpty')).toHaveText('Nessuna fusione decisa finora.');

  const ospite = await apri(app, openTab, { admin: false });
  await apriScheda(ospite, 'log');
  await expect(ospite.locator('#mgLogDenied')).toBeVisible();
  // Un «nessuna fusione» detto senza aver letto niente sarebbe falso.
  await expect(ospite.locator('#mgFusioniSection')).toBeHidden();
});

test('i campi di Automazioni tengono il loro stile, e il Red Team non si stira sulla griglia', async ({ app, openTab }) => {
  const page = await apri(app, openTab);
  await apriScheda(page, 'automation');
  const m = await page.evaluate(() => {
    const titolo = getComputedStyle(document.querySelector('#mgCap3Block .mg-auto-field-label'));
    const interruttore = getComputedStyle(document.querySelector('#mgRoutinesSwitch .mg-switch-text'));
    return {
      larghezze: ['#mgCap3', '#mgMaxSessions', '#mgJudgeTimeout'].map((s) => document.querySelector(s).getBoundingClientRect().width),
      colore: titolo.color, coloreTitoli: interruttore.color, sopra: parseFloat(titolo.marginTop),
    };
  });
  // Le regole generiche delle pagine li allargavano a tutta la colonna e ingrigivano i titoli.
  for (const w of m.larghezze) expect(w).toBeLessThan(120);
  expect(m.colore).toBe(m.coloreTitoli);
  expect(m.sopra).toBe(0);
  await page.screenshot({ path: 'tests/.shots/1110-campi.png' });

  await apriScheda(page, 'stats');
  const rt = await page.evaluate(() => document.querySelector('#mgRtRoot .mg-auto-block').getBoundingClientRect().width);
  expect(rt).toBeLessThanOrEqual(660);
});

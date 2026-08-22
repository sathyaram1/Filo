// VERIFICA AVVERSARIALE (temporaneo) — Gestione → Automazioni:
// "Entrano in coda da soli", un interruttore per ogni categoria di autore.
//
// Il canale verso il processo principale è sostituito da un finto Firestore in
// pagina, così si esercita la VERA pagina (rendering, gate, invio, ripristino)
// senza credenziali admin.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const IDS = {
  owner: '#mgAutoApproveOwner',
  user: '#mgAutoApproveUser',
  local: '#mgAutoApproveLocal',
  worker: '#mgAutoApproveWorker',
  verifier: '#mgAutoApproveVerifier',
  residuo: '#mgAutoApproveResiduo',
  prober: '#mgAutoApproveProber',
  claude: '#mgAutoApproveClaude',
  filo: '#mgAutoApproveFilo',
};

// Installa il finto canale. `doc` = contenuto di config/automation.
// `resolve` replica quello che fa il processo principale (mappa completa).
async function fakeChannel(page, doc, opts = {}) {
  await page.evaluate(([doc, opts]) => {
    const GROUPS = ['owner', 'user', 'local', 'worker', 'verifier', 'residuo', 'prober', 'claude', 'filo'];
    const CLAUDE = ['local', 'worker', 'verifier', 'residuo', 'prober', 'claude'];
    const store = JSON.parse(JSON.stringify(doc));
    window.__vfx = { sent: [], failWrite: !!opts.failWrite, raw: !!opts.raw, store };
    function resolved() {
      const map = store.autoApprove;
      if (!map) return null;
      if (window.__vfx.raw) return map; // il main restituisce la mappa GREZZA
      const legacy = map.claude;
      const out = {};
      for (const g of GROUPS) {
        if (typeof map[g] === 'boolean') out[g] = map[g];
        else if (legacy === false && CLAUDE.includes(g)) out[g] = false;
        else out[g] = true;
      }
      return out;
    }
    const fake = async (msg) => {
      if (!msg || typeof msg !== 'object') return { ok: false };
      if (msg.type === 'auth_status') return { ok: true, isAdmin: true };
      if (msg.type === 'automation_get') {
        return { ok: true, enabled: !!store.enabled, autoApprove: resolved(), proberWhenIdle: true, routinesEnabled: true };
      }
      if (msg.type === 'automation_set') {
        window.__vfx.sent.push(JSON.parse(JSON.stringify(msg)));
        if (window.__vfx.failWrite) return { ok: false, error: 'permission denied' };
        if (typeof msg.enabled === 'boolean') store.enabled = msg.enabled;
        if (msg.autoApprove && typeof msg.autoApprove === 'object') {
          const cur = resolved() || {};
          const next = { ...cur };
          for (const g of GROUPS) if (typeof msg.autoApprove[g] === 'boolean') next[g] = msg.autoApprove[g];
          store.autoApprove = next;
        }
        return { ok: true, enabled: !!store.enabled, autoApprove: resolved(), proberWhenIdle: true, routinesEnabled: true };
      }
      return { ok: false, error: 'non gestito' };
    };
    const prev = (window.filo && window.filo.message) ? window.filo.message.bind(window.filo) : null;
    const wrapped = (msg) => {
      const t = msg && msg.type;
      if (t === 'automation_get' || t === 'automation_set' || t === 'auth_status') return fake(msg);
      return prev ? prev(msg) : Promise.reject(new Error('no channel'));
    };
    try {
      Object.defineProperty(window, 'filo', {
        configurable: true,
        value: new Proxy(window.filo || {}, {
          get(t, k) { return k === 'message' ? wrapped : Reflect.get(t, k); },
        }),
      });
    } catch (_) {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {};
      window.chrome.runtime.sendMessage = wrapped;
    }
    window.__vfx.ready = typeof window.filo?.message === 'function';
  }, [doc, opts]);
}

async function openAutomation(page) {
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.loadAutoMode);
  await page.evaluate(() => window.__mgTest.setTab('automation'));
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadAutoMode());
}

// Clic da UTENTE: la casella vera è invisibile (levetta disegnata), si clicca
// la levetta.
function track(page, group) {
  return page.locator(`label.mg-switch--sm:has(${IDS[group]}) .mg-switch-track`);
}
async function flip(page, group) {
  const t = track(page, group);
  await t.scrollIntoViewIfNeeded();
  await t.click();
}

async function states(page) {
  return page.evaluate((ids) => {
    const out = {};
    for (const [g, sel] of Object.entries(ids)) {
      const el = document.querySelector(sel);
      out[g] = el ? { checked: el.checked, disabled: el.disabled, visible: !!el.closest('label')?.offsetParent } : null;
    }
    return out;
  }, IDS);
}

test('nove interruttori, uno per ogni categoria che la lista mostra con un icona', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await fakeChannel(page, { enabled: true, autoApprove: null });
  await openAutomation(page);

  const s = await states(page);
  for (const g of Object.keys(IDS)) {
    expect(s[g], `manca l'interruttore per «${g}»`).not.toBeNull();
    expect(s[g].visible, `l'interruttore «${g}» non è visibile`).toBeTruthy();
  }
  // Etichette distinte: nessuna categoria confusa con un'altra.
  const labels = await page.evaluate((ids) => Object.values(ids).map(
    (sel) => document.querySelector(sel)?.closest('label')?.querySelector('.mg-switch-text')?.textContent?.trim()), IDS);
  expect(new Set(labels).size).toBe(9);
  expect(labels.filter(Boolean).length).toBe(9);
});

test('VINCOLO: un vecchio no all unico interruttore di Claude NON riaccende le categorie', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  // Mappa GREZZA come sta nel documento vecchio: il main non la risolve.
  await fakeChannel(page, { enabled: true, autoApprove: { owner: true, filo: true, claude: false, user: true } }, { raw: true });
  await openAutomation(page);

  const s = await states(page);
  for (const g of ['local', 'worker', 'verifier', 'residuo', 'prober', 'claude']) {
    expect(s[g].checked, `«${g}» si è riacceso da solo`).toBe(false);
  }
  for (const g of ['owner', 'user', 'filo']) expect(s[g].checked).toBe(true);
});

test('la scelta di una categoria non tocca le altre e viene salvata', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await fakeChannel(page, { enabled: true, autoApprove: { owner: true, filo: true, claude: false, user: true } });
  await openAutomation(page);

  // Accendo SOLO la verifica (parte spenta per eredità del vecchio no).
  expect((await states(page)).verifier.checked).toBe(false);
  await flip(page, 'verifier');
  await page.waitForFunction(() => window.__vfx.sent.length > 0);

  const sent = await page.evaluate(() => window.__vfx.sent[window.__vfx.sent.length - 1]);
  expect(Object.keys(sent.autoApprove)).toEqual(['verifier']);
  expect(sent.autoApprove.verifier).toBe(true);

  const s = await states(page);
  expect(s.verifier.checked).toBe(true);
  for (const g of ['local', 'worker', 'residuo', 'prober', 'claude']) {
    expect(s[g].checked, `«${g}» è cambiato senza che lo toccassi`).toBe(false);
  }

  // Riletta dal canale: la scelta è persistita.
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  await page.waitForTimeout(200);
  const s2 = await states(page);
  expect(s2.verifier.checked).toBe(true);
  expect(s2.prober.checked).toBe(false);
});

test('spegnere una categoria e riaccenderla (si può disfare)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await fakeChannel(page, { enabled: true, autoApprove: null });
  await openAutomation(page);

  await flip(page, 'prober');
  await page.waitForFunction(() => window.__vfx.sent.length === 1);
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  await page.waitForTimeout(150);
  expect((await states(page)).prober.checked).toBe(false);

  await flip(page, 'prober');
  await page.waitForFunction(() => window.__vfx.sent.length === 2);
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  await page.waitForTimeout(150);
  expect((await states(page)).prober.checked).toBe(true);
});

test('salvataggio che fallisce: l interruttore torna indietro e lo dice', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await fakeChannel(page, { enabled: true, autoApprove: null }, { failWrite: true });
  await openAutomation(page);

  expect((await states(page)).prober.checked).toBe(true);
  await flip(page, 'prober');
  await page.waitForFunction(() => window.__vfx.sent.length > 0);
  await expect(page.locator(IDS.prober)).toBeChecked();          // ripristinato
  await expect(page.locator('#mgAutoMsg')).toContainText(/NON è cambiata/i);
});

test('modalità automatica spenta: le categorie sono inerti e si vede', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await fakeChannel(page, { enabled: false, autoApprove: null });
  await openAutomation(page);

  const s = await states(page);
  for (const g of Object.keys(IDS)) expect(s[g].disabled, `«${g}» resta cliccabile`).toBe(true);
  await expect(page.locator('#mgAutoApproveBlock')).toHaveClass(/mg-auto-sub--off/);
});

test('doppio clic rapido su una categoria: lo stato finale è coerente col salvato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await fakeChannel(page, { enabled: true, autoApprove: null });
  await openAutomation(page);

  const t = track(page, 'worker');
  await t.scrollIntoViewIfNeeded();
  await t.click();
  await t.click();
  await page.waitForFunction(() => window.__vfx.sent.length >= 2);
  await page.waitForTimeout(400);
  const uiChecked = await page.locator(IDS.worker).isChecked();
  const saved = await page.evaluate(() => window.__vfx.store.autoApprove.worker);
  expect(uiChecked, 'schermo e salvato divergono dopo due clic rapidi').toBe(saved);
});

test('accendere la modalità automatica sblocca le categorie senza riaprire la pagina', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  // Parte spenta, con la scelta vecchia già salvata.
  await fakeChannel(page, { enabled: false, autoApprove: { owner: true, filo: true, claude: false, user: true } });
  await openAutomation(page);
  expect((await states(page)).prober.disabled).toBe(true);

  // L'owner accende l'automatica dalla levetta grande.
  const master = page.locator('label#mgAutoSwitch .mg-switch-track');
  await master.scrollIntoViewIfNeeded();
  await master.click();
  await expect(page.locator('#mgAutoState')).toHaveText('On');

  const s = await states(page);
  for (const g of Object.keys(IDS)) expect(s[g].disabled, `«${g}» resta bloccato`).toBe(false);
  // E mostrano la scelta vera, non tutto acceso.
  for (const g of ['local', 'worker', 'verifier', 'residuo', 'prober', 'claude']) {
    expect(s[g].checked, `«${g}» si è riacceso accendendo l'automatica`).toBe(false);
  }
  await expect(page.locator('#mgAutoApproveBlock')).not.toHaveClass(/mg-auto-sub--off/);
});

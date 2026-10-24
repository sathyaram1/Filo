// I LAVORI SERVER IN GESTIONE (#1159, SPEC-DOMANDE.md §6–7).
//
// COSA DEVE ESSERE VERO
//   1. I lavori col segno `localOnly` non hanno una scheda loro (#1575): stanno nella scheda del loro stato, con
//      l'etichetta «server».
//   2. Automazioni: l'interruttore «Lavori server alle routine» nasce spento (campo assente), si accende e si spegne,
//      e ogni gesto arriva al main come `lavoriServer` vero/falso; un salvataggio fallito torna indietro e lo dice.
//   3. Una pratica passata in cloud che aspetta il PC lo dice sulla scheda («Pronto: aspetta il PC»); rimessa in coda no.
//   4. Fase 2 (#1222): la scheda dice anche quando aspetta la suite del server o la pubblicazione da GitHub.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const SEGNO = { by: 'owner@esempio', at: Date.parse('2026-10-10T08:00:00Z') };

function fb(over = {}) {
  return Object.assign({
    _id: 'srv-1', name: 'Il token del server si rinnova', text: 'Lavoro sul server.',
    seq: 1200, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato', localOnly: SEGNO,
    createdAt: '2026-10-10T07:00:00Z', images: [],
  }, over);
}

async function stubAutomazioni(page, { lavoriServer, rompi = false } = {}) {
  await page.evaluate((cfg) => {
    window.__auto = { enabled: false, autoApprove: {}, routinesEnabled: true };
    if (cfg.lavoriServer !== undefined) window.__auto.lavoriServer = cfg.lavoriServer;
    window.__autoSets = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'automation_get') return Object.assign({ ok: true }, window.__auto);
      if (msg && msg.type === 'automation_set') {
        window.__autoSets.push(Object.fromEntries(Object.entries(msg).filter(([k]) => k !== 'type')));
        if (cfg.rompi) return { ok: false, error: 'rete giù' };
        if (typeof msg.lavoriServer === 'boolean') window.__auto.lavoriServer = msg.lavoriServer;
        return Object.assign({ ok: true }, window.__auto);
      }
      return orig(msg);
    };
  }, { lavoriServer, rompi });
}

async function apriAutomazioni(page, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await apriScheda(page, 'automation');
  await stubAutomazioni(page, opts);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadAutoMode());
}

const cambia = (page, acceso) => page.evaluate((v) => {
  const el = document.getElementById('mgLavoriServer');
  el.checked = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, acceso);

test('nessuna scheda «Lavori server»: il lavoro col segno sta nella scheda del suo stato, con l’etichetta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(page.locator('.mg-tab[data-tab="local"]')).toHaveCount(0);
  await expect(page.locator('.mg-tab', { hasText: /Lavori (server|locali)/ })).toHaveCount(0);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fb()]);
  await apriScheda(page, 'queue');
  await expect(page.locator('.mg-item[data-id="srv-1"] .mg-local-badge')).toHaveText('server');
});

test('Automazioni: «Lavori server alle routine» nasce spento, si accende e si spegne, e arriva al main', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriAutomazioni(page);
  const sw = page.locator('#mgLavoriServer');
  await expect(page.locator('#mgLavoriServerBlock')).toBeVisible();
  await expect(page.locator('#mgLavoriServerBlock')).toContainText('Lavori server alle routine');
  await expect(page.locator('#mgLavoriServer + .mg-switch-track')).toBeVisible();
  await expect(sw).toBeEnabled();
  await expect(sw).not.toBeChecked();

  await cambia(page, true);
  await expect.poll(() => page.evaluate(() => window.__auto.lavoriServer)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__autoSets)).toContainEqual({ lavoriServer: true });
  await expect(sw).toBeChecked();

  await cambia(page, false);
  await expect.poll(() => page.evaluate(() => window.__auto.lavoriServer)).toBe(false);
  await expect(sw).not.toBeChecked();
  // Solo il campo toccato: gli altri interruttori non viaggiano con lui.
  expect(await page.evaluate(() => window.__autoSets)).toEqual([{ lavoriServer: true }, { lavoriServer: false }]);
});

test('Automazioni: acceso sul server si legge acceso; un salvataggio fallito torna indietro e lo dice', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriAutomazioni(page, { lavoriServer: true, rompi: true });
  const sw = page.locator('#mgLavoriServer');
  await expect(sw).toBeChecked();
  await cambia(page, false);
  await expect(page.locator('#mgLavoriServerMsg')).toContainText('NON è cambiata');
  await expect(sw).toBeChecked();
});

test('Automazioni: chi non è owner vede l’interruttore ma non lo muove', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await apriScheda(page, 'automation');
  await page.evaluate(() => window.__mgTest.setAdmin(false));
  await expect(page.locator('#mgLavoriServer')).toBeDisabled();
});

test('una pratica passata che aspetta il PC lo dice sulla scheda; rimessa in coda no', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubAutomazioni(page);
  const pronta = fb({ status: 'revision_security', attesa: 'fusione_server', branch: 'worker/srv-1-20261012T090000Z' });
  const rimessa = fb({ _id: 'srv-2', seq: 1201, status: 'todo', attesa: 'fusione_server' });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [pronta, rimessa]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const riga = page.locator('.mg-item[data-id="srv-1"] .mg-attesa-server');
  await expect(riga).toHaveText('Pronto: aspetta il PC');
  await expect(riga).toHaveAttribute('title', /aspetta il tuo PC.*fusioni-server/);
  await expect(page.locator('.mg-item[data-id="srv-1"]')).not.toContainText('sessione locale');
  await expect(page.locator('.mg-item[data-id="srv-2"]')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="srv-2"] .mg-attesa-server')).toHaveCount(0);
});

test('#1222: la scheda dice quando il server aspetta la suite; un segno di attesa che non esiste non si mostra', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubAutomazioni(page);
  const suite = fb({ _id: 'srv-3', seq: 1202, status: 'revision_security', attesa: 'suite_server', branch: 'worker/srv-3-20261014T090000Z' });
  const deploy = fb({ _id: 'srv-4', seq: 1203, status: 'revision_security', attesa: 'deploy_server', branch: 'worker/srv-4-20261014T090000Z' });
  const altro = fb({ _id: 'srv-5', seq: 1204, status: 'revision_security', attesa: 'boh', branch: 'worker/srv-5-20261014T090000Z' });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [suite, deploy, altro]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const s = page.locator('.mg-item[data-id="srv-3"] .mg-attesa-server');
  await expect(s).toHaveText('Aspetta le prove del server');
  await expect(s).toHaveAttribute('title', /suite di GitHub è verde su quel commit/);
  await expect(s).toHaveAttribute('title', /prima la parte dell’app|la parte dell’app e poi il ramo di filo-security/);
  // L'app si fonde prima del server (#1222): l'attesa della pubblicazione non c'è più, e un segno rimasto non si mostra.
  await expect(page.locator('.mg-item[data-id="srv-4"]')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="srv-4"] .mg-attesa-server')).toHaveCount(0);
  await expect(page.locator('.mg-item[data-id="srv-5"]')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="srv-5"] .mg-attesa-server')).toHaveCount(0);
});

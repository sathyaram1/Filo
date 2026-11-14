// I LAVORI SERVER IN GESTIONE (#1159, SPEC-DOMANDE.md §6–7).
//
// COSA DEVE ESSERE VERO
//   1. I lavori col segno `localOnly` non hanno una scheda loro (#1575): stanno nella scheda del loro stato, con
//      l'etichetta «server».
//   2. Automazioni: l'interruttore «Lavori server alle routine» nasce spento (campo assente), si accende e si spegne,
//      e ogni gesto arriva al main come `lavoriServer` vero/falso; un salvataggio fallito torna indietro e lo dice.
//   3. Una pratica passata in cloud che aspetta il PC lo dice sulla scheda («Pronto: aspetta il PC»); rimessa in coda no.
//   4. Fase 2 (#1222): la scheda dice anche quando aspetta la suite del server o la pubblicazione da GitHub.
//   5. #2258: un lavoro fermo «resta locale» ha nel dettaglio «Dichiara fidato com'è»: prima il server dice cosa, la
//      conferma rimanda quello che l'owner ha visto, e il fermo sparisce; un rifiuto lo dice e lascia riprovare.

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

// #2217: le routine prendono un lavoro server solo fidato; a uno non fidato l'etichetta non lo promette.
test('l’etichetta «server» di un lavoro non fidato dice che aspetta il timbro, quella di un fidato le routine', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); },
    [fb(), fb({ _id: 'srv-2', seq: 1201, fiducia: 'non_fidato', localOnly: { by: 'routine', at: SEGNO.at } })]);
  await apriScheda(page, 'queue');
  await expect(page.locator('.mg-item[data-id="srv-1"] .mg-local-badge')).toHaveAttribute('title', /Lo prendono le routine/);
  const nonFidato = page.locator('.mg-item[data-id="srv-2"] .mg-local-badge');
  await expect(nonFidato).toHaveAttribute('title', /non fidato: nessuna routine lo prende finché non lo segni fidato/);
  await expect(nonFidato).not.toHaveAttribute('title', /Lo prendono le routine/);
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

test('#2036: un lavoro server che nessuna routine prende sta fermo sulla scheda, col motivo; sanato torna all’iter', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubAutomazioni(page, { lavoriServer: true });
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  const fermo = fb({ _id: 'srv-6', seq: 1903, status: 'revision_security', branch: 'worker/srv-6-20261101T090000Z',
    restaLocale: { motivi: ['ramo non pulito', '<b>ramo del server non pulito</b>'], ruolo: 'secaudit', atMs: Date.parse('2026-11-01T12:00:00Z') } });
  const sanato = fb({ _id: 'srv-7', seq: 1904, status: 'revision_security', branch: 'worker/srv-7-20261101T090000Z', restaLocale: null });
  const sporco = fb({ _id: 'srv-8', seq: 1905, status: 'revision_capability', branch: 'worker/srv-8-20261101T090000Z',
    restaLocale: { motivi: ['contenuto scritto da un biglietto sporco'], ruolo: 'new-work', atMs: Date.parse('2026-11-01T12:00:00Z') } });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fermo, sanato, sporco]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const riga = page.locator('.mg-item[data-id="srv-6"] .mg-attesa-server');
  await expect(riga).toHaveText('Fermo: resta locale');
  await expect(riga).toHaveAttribute('title', /biglietto nascerebbe non fidato \(ramo non pulito, <b>ramo del server non pulito<\/b>\)/);
  // Nessun motivo passa da solo (#2036.1): la scheda dice il gesto che sblocca, non promette una ripartenza.
  const spiega = (await riga.getAttribute('title')) || '';
  expect(spiega).not.toMatch(/riparte da solo/i);
  expect(spiega).toContain('npm run fiducia:sana -- worker/srv-6-20261101T090000Z;');
  expect(spiega).toContain('npm run fiducia:sana -- worker/srv-6-20261101T090000Z --server');
  const rigaSporca = page.locator('.mg-item[data-id="srv-8"] .mg-attesa-server');
  await expect(rigaSporca).toHaveText('Fermo: resta locale');
  await expect(rigaSporca).toHaveAttribute('title', /non torna pulito da solo: se l’hai letto, «Dichiara fidato com’è»/);
  await expect(rigaSporca).not.toHaveAttribute('title', /riparte da solo|sanatoria/i);
  await expect(page.locator('.mg-item[data-id="srv-6"] b')).toHaveCount(0);
  await expect(page.locator('.mg-item[data-id="srv-7"]')).toBeVisible();
  await expect(page.locator('.mg-item[data-id="srv-7"] .mg-attesa-server')).toHaveCount(0);
  await page.locator('.mg-item[data-id="srv-6"]').screenshot({ path: 'tests/.shots/manage-resta-locale-2036.png' });
});

test('#2036.1: coi lavori server spenti il segno di fermo rimasto non copre la sessione locale', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubAutomazioni(page, { lavoriServer: true });
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  const fermo = fb({ _id: 'srv-9', seq: 1906, status: 'revision_security', branch: 'worker/srv-9-20261101T090000Z',
    restaLocale: { motivi: ['ramo non pulito'], ruolo: 'secaudit', atMs: Date.parse('2026-11-01T12:00:00Z') } });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fermo]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  const scheda = page.locator('.mg-item[data-id="srv-9"]');
  await expect(scheda.locator('.mg-attesa-server')).toHaveText('Fermo: resta locale');
  // L'owner spegne i lavori server: il lavoro torna in mano locale e la scheda lo dice subito.
  await page.evaluate(() => { window.__auto.lavoriServer = false; return window.__mgTest.loadAutoMode(); });
  await expect(scheda.locator('.mg-attesa-server')).toHaveCount(0);
  await expect(scheda).toContainText('In verifica in una sessione locale');
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

const PUNTA_APP = 'a'.repeat(40);
const PUNTA_SRV = 'b'.repeat(40);

async function stubDichiara(page, { rifiutaLaPrima = false, niente = false } = {}) {
  await page.evaluate((cfg) => {
    window.__dichiara = [];
    let rifiuti = cfg.rifiutaLaPrima ? 1 : 0;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (!msg || msg.type !== 'fiducia_dichiara') return orig(msg);
      window.__dichiara.push(Object.fromEntries(Object.entries(msg).filter(([k]) => k !== 'type')));
      if (cfg.niente) return { ok: true, niente: true };
      if (msg.prova) {
        const scritti = [{ at: Date.parse('2026-11-06T13:32:00Z'), ruolo: 'fixer' }, { at: Date.parse('2026-11-07T08:10:00Z'), ruolo: 'manutentore' }];
        return { ok: true, stato: 2, scritti, visto: { stato: 2, app: cfg.app, server: cfg.srv }, rami: [
          { repo: 'app', punta: cfg.app, motivo: 'una voce di biglietti non fidati' },
          { repo: 'server', punta: cfg.srv, motivo: '<b>la punta</b> non è l’ultima registrata' },
        ] };
      }
      if (rifiuti-- > 0) return { ok: false, error: 'il lavoro è cambiato da quando l’hai guardato: riguardalo prima di dichiararlo fidato' };
      return { ok: true, rami: [], stato: 2 };
    };
  }, { rifiutaLaPrima, niente, app: PUNTA_APP, srv: PUNTA_SRV });
}

async function apriFermo(page, opzioni) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  // Coi lavori server spenti il segno rimasto non è un fermo (#2036.1): qui sono accesi.
  await stubAutomazioni(page, { lavoriServer: true });
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  await stubDichiara(page, opzioni);
  const fermo = fb({ _id: 'srv-8', seq: 1160, status: 'todo', branch: 'worker/srv-8-20261029T090000Z',
    restaLocale: { motivi: ['ramo non pulito', 'contenuto scritto da un biglietto sporco'], ruolo: 'new-work', atMs: Date.parse('2026-11-07T10:00:00Z') } });
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fermo]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.evaluate(() => window.__mgTest.openDetail('srv-8'));
}

test('#2258: l’owner dichiara fidato com’è un lavoro fermo «resta locale»: vede cosa, conferma, e il fermo sparisce', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriFermo(page, { rifiutaLaPrima: true });
  const stato = page.locator('#mgWorkState');
  // In coda (todo) non c'è iter: il fermo si dice lo stesso, nell'elenco e nel dettaglio.
  await expect(page.locator('.mg-item[data-id="srv-8"] .mg-attesa-server')).toHaveText('Fermo: resta locale');
  await expect(stato.locator('.mg-attesa-server')).toHaveText('Fermo: resta locale');
  const btn = page.locator('#mgDichiaraBtn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('title', /riparte al giro dopo/);
  await btn.click();
  const cosa = stato.locator('.mg-dichiara-cosa li');
  await expect(cosa).toHaveText([
    'Ramo dell’app, all’ultimo commit aaaaaaa: una voce di biglietti non fidati',
    'Ramo del server, all’ultimo commit bbbbbbb: <b>la punta</b> non è l’ultima registrata',
    // Quando e da chi: l'owner trova le note da leggere senza rileggerle tutte.
    /^2 scritti di biglietti non fidati fra note e critiche: Correzione 0\d\/11\/2026 \d\d:32; Manutenzione 0\d\/11\/2026 \d\d:10$/,
  ]);
  await expect(stato.locator('.mg-dichiara b')).toHaveCount(0);
  // Si dichiara dopo aver letto: ogni ramo apre le sue modifiche rispetto a main, nel suo repo.
  await expect(cosa.nth(0).locator('a')).toHaveAttribute('href', 'https://github.com/sathyaram1/Filo/compare/main...worker/srv-8-20261029T090000Z');
  await expect(cosa.nth(1).locator('a')).toHaveAttribute('href', 'https://github.com/sathyaram1/filo-security/compare/main...worker/srv-8-20261029T090000Z');
  await expect(cosa.nth(0).locator('a')).toHaveAttribute('target', '_blank');
  await expect(cosa.nth(2).locator('a')).toHaveCount(0);
  await page.locator('#mgWorkState').screenshot({ path: 'tests/.shots/manage-dichiara-fidato-2258.png' });
  // Il primo sì trova il lavoro cambiato: lo dice, e la conferma resta lì per riprovare.
  await page.locator('#mgDichiaraSi').click();
  await expect(page.locator('#mgManageMsg')).toHaveText(/Non dichiarato fidato: il lavoro è cambiato/);
  await expect(page.locator('#mgDichiaraSi')).toBeEnabled();
  await page.locator('#mgDichiaraSi').click();
  await expect(page.locator('#mgManageMsg')).toHaveText('Ramo e note del lavoro di #1160 sono fidati: riparte al prossimo giro, se non lo ferma altro.');
  await expect(stato.locator('.mg-attesa-server')).toHaveCount(0);
  await expect(page.locator('#mgDichiaraBtn')).toHaveCount(0);
  await expect(page.locator('.mg-item[data-id="srv-8"] .mg-attesa-server')).toHaveCount(0);
  const visto = { stato: 2, app: PUNTA_APP, server: PUNTA_SRV };
  expect(await page.evaluate(() => window.__dichiara)).toEqual([
    { feedbackId: 'srv-8', prova: true }, { feedbackId: 'srv-8', visto }, { feedbackId: 'srv-8', visto },
  ]);
});

test('#2258: annullare torna al tasto senza scrivere; se ramo e note sono già puliti lo dice, col motivo che resta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriFermo(page);
  await page.locator('#mgDichiaraBtn').click();
  await page.locator('#mgDichiaraNo').click();
  await expect(page.locator('#mgDichiaraBtn')).toBeVisible();
  await expect(page.locator('.mg-dichiara-cosa')).toHaveCount(0);
  expect(await page.evaluate(() => window.__dichiara)).toEqual([{ feedbackId: 'srv-8', prova: true }]);

  const altra = await openTab(MANAGE);
  await apriFermo(altra, { niente: true });
  await altra.locator('#mgDichiaraBtn').click();
  await expect(altra.locator('#mgManageMsg')).toHaveText('Ramo e note sono già puliti: lo tiene fermo altro (ramo non pulito, contenuto scritto da un biglietto sporco).');
  await expect(altra.locator('#mgWorkState .mg-attesa-server')).toHaveText('Fermo: resta locale');
});

test('#2258: senza essere l’owner il tasto non c’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriFermo(page);
  await page.evaluate(() => { window.__mgTest.setAdmin(false); window.__mgTest.openDetail('srv-8'); });
  await expect(page.locator('#mgWorkState .mg-attesa-server')).toHaveText('Fermo: resta locale');
  await expect(page.locator('#mgDichiaraBtn')).toHaveCount(0);
});

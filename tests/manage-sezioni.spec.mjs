// #1150 (SPEC-DOMANDE §2.1): Gestione a sezioni. Le schede di oggi si spostano senza cambiare, ogni sezione ha
// un numero solo quando lo sa, e l'ultima sezione torna intera alla riapertura, con la sua scheda caricata.
import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const MANAGE = 'filo://manage/manage.html';
const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x' };
const fb = (id, seq, status, extra) => ({ ...base, _id: id, seq, name: `Segnalazione ${seq}`, status, ...extra });

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
}

// Registra i tipi di messaggio verso il main e risponde da owner, così i caricamenti pigri partono davvero.
async function registraChiamate(page) {
  await page.evaluate(() => {
    window.__chiamate = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      window.__chiamate.push(t);
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'worker_log_get') return { ok: true, entries: [] };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
}
const chiamate = (page) => page.evaluate(() => window.__chiamate.slice());

test('la barra mostra le quattro sezioni e ogni scheda si apre dalla sua', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);

  const sezioni = page.locator('.mg-sezione');
  await expect(sezioni).toHaveCount(4);
  expect((await sezioni.allInnerTexts()).map((t) => t.replace(/\s*\(.*\)$/, '').trim()))
    .toEqual(['Domande', 'Feedback', 'Routine', 'Impostazioni predefinite']);
  // Si parte da Feedback: le sue schede si vedono, quelle delle altre sezioni no.
  await expect(page.locator('.mg-sezione[data-sezione="feedback"]')).toHaveClass(/mg-sezione--active/);
  for (const t of ['inbox', 'queue', 'local', 'resolved', 'archived', 'fbstats', 'stats']) {
    await expect(page.locator(`.mg-tab[data-tab="${t}"]`), t).toBeVisible();
  }
  for (const t of ['automation', 'log', 'models', 'domande', 'domande-lavoro', 'domande-archivio']) {
    await expect(page.locator(`.mg-tab[data-tab="${t}"]`), t).toBeHidden();
  }

  const panelDi = { automation: 'panel-automation', log: 'panel-log', models: 'panel-models', fbstats: 'panel-fbstats', stats: 'panel-stats', queue: 'panel-list', domande: 'panel-domande' };
  for (const [tab, panel] of Object.entries(panelDi)) {
    await apriScheda(page, tab);
    await expect(page.locator(`#${panel}`), tab).toHaveClass(/mg-panel--active/);
    await expect(page.locator(`.mg-tab[data-tab="${tab}"]`), tab).toHaveClass(/mg-tab--active/);
  }

  // Tornando a una sezione si ritrova la scheda che ci si era lasciata.
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await expect(page.locator('.mg-tab[data-tab="log"]')).toHaveClass(/mg-tab--active/);
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveClass(/mg-tab--active/);
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
});

test('le schede spostate caricano anche aperte dalla sezione, non solo dal loro clic', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await registraChiamate(page);
  const MSG = await page.evaluate(() => window.SN_MSG.MSG);

  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await expect(page.locator('#panel-automation')).toHaveClass(/mg-panel--active/);
  await expect.poll(() => chiamate(page)).toContain('merge_approvals_get');

  await page.evaluate(() => { window.__chiamate.length = 0; });
  await page.locator('.mg-tab[data-tab="log"]').click();
  await expect.poll(() => chiamate(page)).toContain(MSG.WORKER_LOG_GET || 'worker_log_get');
  await page.locator('.mg-sezione[data-sezione="feedback"]').click();
  // La lettura del log in volo ignora una seconda richiesta: si aspetta che finisca.
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__chiamate.length = 0; });
  // La sezione riapre il Log, e il Log si rilegge come a ogni sua apertura.
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await expect(page.locator('#panel-log')).toHaveClass(/mg-panel--active/);
  await expect.poll(() => chiamate(page)).toContain(MSG.WORKER_LOG_GET || 'worker_log_get');
});

test('i numeri delle sezioni: solo quando il dato c’è', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  const numero = (s) => page.locator(`.mg-sezione[data-sezione="${s}"] .mg-sezione-count`);

  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 1, 'unlabeled'), fb('i2', 2, 'design', { statusReason: 'secaudit' }), fb('q1', 3, 'todo'),
  ]);
  await expect(numero('feedback')).toHaveText('(2)');
  // Impostazioni non elenca niente; Routine senza fusioni in attesa non ha niente da dire.
  await expect(numero('impostazioni')).toHaveText('');
  await expect(numero('routine')).toHaveText('');
  // Domande: il server non le pubblica ancora, quindi nessun numero e lo si dice nel pannello.
  await expect(numero('domande')).toHaveText('');
  await apriScheda(page, 'domande');
  await expect(page.locator('#mgDomandeStato')).toContainText('non sono ancora disponibili');

  await page.evaluate(() => window.__mgTest.setDomande([
    { id: 'D-1', numero: 1, stato: 'aperta', priorita: 'importante', titolo: 'Una', creataIl: Date.now() },
    { id: 'D-2', numero: 2, stato: 'chiusa', priorita: 'quando_puoi', titolo: 'Due', creataIl: Date.now() },
  ]));
  await expect(numero('domande')).toHaveText('(1)');
  await expect(page.locator('.mg-tab[data-tab="domande-archivio"]')).toHaveText('Archivio (1)');

  // Un guasto non lascia numeri vecchi.
  await page.evaluate(() => window.__mgTest.setDomande(null, { errore: 'rete giù' }));
  await expect(numero('domande')).toHaveText('');
  await expect(page.locator('.mg-tab[data-tab="domande"]')).toHaveText('Da rispondere');
  await page.evaluate(() => window.__mgTest.simulaCaricamentoFallito());
  await expect(numero('feedback')).toHaveText('');
});

test('l’ultima sezione torna intera alla riapertura, con la sua scheda caricata', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await apriScheda(page, 'log');
  const ricordata = await page.evaluate(() => JSON.parse(localStorage.getItem('filo_manage_sezione')));
  expect(ricordata.sezione).toBe('routine');
  expect(ricordata.schede.routine).toBe('log');

  // Ricevuti vuoti e nessuna bloccante: vince l'ultima sezione, e la scheda si carica come se l'avessi cliccata.
  await page.evaluate((items) => window.__mgTest.setData(items), [fb('q1', 3, 'todo')]);
  await page.evaluate(() => window.__mgTest.setSezione('feedback'));
  await registraChiamate(page);
  const MSG = await page.evaluate(() => window.SN_MSG.MSG);
  const scelta = await page.evaluate(() => window.__mgTest.sceltaApertura());
  expect(scelta.motivo).toBe('ultima');
  await expect(page.locator('.mg-tab[data-tab="log"]')).toHaveClass(/mg-tab--active/);
  await expect(page.locator('#panel-log')).toHaveClass(/mg-panel--active/);
  await expect.poll(() => chiamate(page)).toContain(MSG.WORKER_LOG_GET || 'worker_log_get');

  // Una memoria storta non porta da nessuna parte: si riparte da Feedback → Ricevuti.
  await page.evaluate(() => localStorage.setItem('filo_manage_sezione', JSON.stringify({ sezione: 'routine', schede: { routine: 'models' } })));
  expect((await page.evaluate(() => window.__mgTest.sceltaApertura())).motivo).toBe('predefinita');
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveClass(/mg-tab--active/);
});

test('la lente da un’altra sezione porta ai feedback e cerca lì', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate((items) => window.__mgTest.setData(items), [fb('i1', 1, 'unlabeled')]);
  await apriScheda(page, 'models');
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchInput')).toBeVisible();
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('.mg-sezione[data-sezione="feedback"]')).toHaveClass(/mg-sezione--active/);
});

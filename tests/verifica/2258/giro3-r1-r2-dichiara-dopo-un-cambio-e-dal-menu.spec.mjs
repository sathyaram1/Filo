// Verifica #2258 giro 3: «Dichiara fidato com'è» dopo un rifiuto per lavoro cambiato, e dal tasto destro della riga.
// Il server è simulato come quello vero: la conferma passa solo con quello che il lavoro è adesso.

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const SEGNO = { by: 'owner@esempio', at: Date.parse('2026-10-10T08:00:00Z') };
const PUNTA_APP = 'a'.repeat(40);
const PUNTA_SRV = 'b'.repeat(40);
const PUNTA_NUOVA = 'c'.repeat(40);

function fermo() {
  return {
    _id: 'srv-8', name: 'Il token del server si rinnova', text: 'Lavoro sul server.',
    seq: 1160, subSeq: 0, status: 'todo', statusPublic: 'open',
    clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato', localOnly: SEGNO,
    createdAt: '2026-10-10T07:00:00Z', images: [], branch: 'worker/srv-8-20261029T090000Z',
    restaLocale: { motivi: ['ramo non pulito', 'contenuto scritto da un biglietto sporco'], ruolo: 'new-work', atMs: Date.parse('2026-11-07T10:00:00Z') },
  };
}

// Un server che tiene lo stato vero: dopo la prima prova il ramo del server riceve una spinta.
async function stub(page) {
  await page.evaluate((cfg) => {
    window.__dichiara = [];
    const vero = { stato: 2, app: cfg.app, server: cfg.srv };
    let prove = 0;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (msg && msg.type === 'automation_get') return { ok: true, enabled: false, autoApprove: {}, routinesEnabled: true };
      if (!msg || msg.type !== 'fiducia_dichiara') return orig(msg);
      window.__dichiara.push(Object.fromEntries(Object.entries(msg).filter(([k]) => k !== 'type')));
      if (msg.prova) {
        const visto = Object.assign({}, vero);
        if (++prove === 1) vero.server = cfg.nuova;
        return { ok: true, stato: visto.stato, scritti: [], visto, rami: [
          { repo: 'app', punta: visto.app, motivo: 'una voce di biglietti non fidati' },
          { repo: 'server', punta: visto.server, motivo: 'un buco nel registro' },
        ] };
      }
      const v = msg.visto || {};
      if (v.stato !== vero.stato || v.app !== vero.app || v.server !== vero.server) {
        return { ok: false, error: 'il lavoro è cambiato da quando l’hai guardato: riguardalo prima di dichiararlo fidato' };
      }
      return { ok: true, rami: [], stato: 2 };
    };
  }, { app: PUNTA_APP, srv: PUNTA_SRV, nuova: PUNTA_NUOVA });
}

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stub(page);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, [fermo()]);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
}

test('r1 il lavoro cambiato fra la prova e la conferma: l’owner vede com’è adesso e lo dichiara, senza un tasto che rifiuta per sempre', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.openDetail('srv-8'));
  await page.locator('#mgDichiaraBtn').click();
  await expect(page.locator('#mgWorkState .mg-dichiara-cosa li').nth(1)).toContainText('bbbbbbb');
  await page.locator('#mgDichiaraSi').click();
  await expect(page.locator('#mgManageMsg')).toHaveText(/il lavoro è cambiato/);
  // Quello che si dichiara deve essere quello che c'è adesso: il riquadro lo mostra, e la conferma passa.
  await expect(page.locator('#mgWorkState .mg-dichiara-cosa li').nth(1)).toContainText('ccccccc', { timeout: 5000 });
  await page.locator('#mgDichiaraSi').click();
  await expect(page.locator('#mgManageMsg')).toHaveText(/sono fidati: riparte al prossimo giro/, { timeout: 5000 });
});

test('r2 il tasto destro sulla riga di un lavoro fermo «resta locale» offre «Dichiara fidato com’è», come il dettaglio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await expect(page.locator('.mg-item[data-id="srv-8"] .mg-attesa-server')).toHaveText('Fermo: resta locale');
  await page.locator('.mg-item[data-id="srv-8"]').click({ button: 'right' });
  const voce = page.locator('.mg-ctxmenu [role="menuitem"]', { hasText: /Dichiara fidato/ });
  await expect(voce).toHaveCount(1, { timeout: 3000 });
  await voce.click();
  await expect(page.locator('#mgWorkState .mg-dichiara-cosa li')).toHaveCount(2);
});

test('aspetto del riquadro di conferma, chiaro e scuro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.openDetail('srv-8'));
  await page.locator('#mgDichiaraBtn').click();
  await expect(page.locator('#mgDichiaraSi')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-2258-g3-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/verifica-2258-g3-scuro.png' });
});

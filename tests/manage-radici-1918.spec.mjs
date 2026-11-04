// LE RADICI ACCANTO A «SEGNA FIDATO» (#1918, SPEC-DOMANDE.md §1.8).
//
// COSA DEVE ESSERE VERO
//   1. Sul dettaglio di una pratica non fidata, accanto a «Segna fidato», ci sono le sue radici dette dal server:
//      «nato prima» per legacy, «#N» per il testo di un utente; una timbrata ha la spunta.
//   2. Un clic su una radice la timbra (al main va la radice, non il feedback), il messaggio dice quante cose hanno
//      cambiato fiducia, e se la pratica è diventata fidata il tasto lo dice subito.
//   3. Su una radice timbrata un clic toglie il timbro (si può togliere ciò che si mette); `ignota` non si clicca.
//   4. Un server che non sa dire le radici non rompe niente: il cartellino non c'è, il tasto resta.
//   5. Una radice dichiarata da una sessione mostra il suo nome (l'indirizzo), mai il segno che sta sul documento.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

function fb(over = {}) {
  return Object.assign({
    _id: 'u-1916', name: 'Il riquadro si chiude da solo', text: 'Testo di un utente.',
    seq: 1916, subSeq: 0, status: 'todo', statusPublic: 'open', fiducia: 'non_fidato',
    clientId: 'utente-abc', createdAt: '2026-10-28T07:00:00Z', images: [],
  }, over);
}

async function stubMain(page, { radici = null, dopo = null } = {}) {
  await page.evaluate(({ radici, dopo }) => {
    window.__segna = [];
    window.__lette = 0;
    let timbrata = false;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'fiducia_radici') {
        window.__lette += 1;
        if (!radici) return { ok: false, error: 'Il server non sa ancora dire le radici: arriva col prossimo aggiornamento del server.' };
        const l = timbrata && dopo ? dopo : radici;
        return { ok: true, fiducia: l.every((x) => x.timbrata) ? 'fidato' : 'non_fidato', radici: l };
      }
      if (t === 'fiducia_segna') {
        window.__segna.push(msg);
        timbrata = msg.fidato !== false;
        return { ok: true, radice: msg.radice, timbrata, cambiati: { feedback: 2, domande: 1 } };
      }
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      return orig(msg);
    };
  }, { radici, dopo });
}

async function apri(page, lista, opts) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await stubMain(page, opts);
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await page.locator('.mg-item').first().click();
}

const LEGACY = { radice: 'legacy', tipo: 'legacy', valore: '', timbrata: false, testoUtente: false, daLeggere: false, timbrabile: true };
const UTENTE = { radice: 'feedback:1916', tipo: 'feedback', valore: '1916', timbrata: false, testoUtente: true, daLeggere: true, timbrabile: true };
const IGNOTA = { radice: 'ignota', tipo: 'ignota', valore: '', timbrata: false, testoUtente: false, daLeggere: true, timbrabile: false };
// Dichiarata da una sessione: sul documento il segno, il nome lo dà il server solo all'owner.
const PAGINA = { radice: 'web:#0123456789abcdef', tipo: 'web', valore: '#0123456789abcdef', nome: 'web:https://esempio.it/pagina', timbrata: false, testoUtente: false, daLeggere: true, timbrabile: true };
const SESSIONE = { radice: 'esterno:biglietto 0123456789abcdef', tipo: 'esterno', valore: 'biglietto 0123456789abcdef', timbrata: false, testoUtente: false, daLeggere: true, timbrabile: true };

test('le radici stanno accanto a «Segna fidato», ognuna col suo nome e col suo perché', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], { radici: [UTENTE, LEGACY, IGNOTA, PAGINA, SESSIONE] });
  const chips = page.locator('#mgRadici .mg-radice');
  await expect(page.locator('#mgFiduciaBtn')).toBeVisible();
  await expect(chips).toHaveText(['#1916', 'nato prima', 'provenienza ignota', 'esempio.it', 'sessione sporca']);
  await expect(chips.nth(0)).toHaveAttribute('title', /testo dell’utente di #1916: leggilo prima/);
  await expect(chips.nth(1)).toHaveAttribute('title', /timbra in blocco tutto ciò che è nato prima/);
  await expect(chips.nth(2)).toBeDisabled();
  await expect(chips.nth(3)).toHaveAttribute('title', /^web:https:\/\/esempio\.it\/pagina: guardalo prima/);
  await expect(chips.nth(4)).toHaveAttribute('title', /letto senza dire da dove/);
  await page.screenshot({ path: 'tests/.shots/manage-radici-1918.png' });
});

test('un clic su «nato prima» timbra legacy: al main va la radice, e la pratica diventata fidata lo dice subito', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], { radici: [LEGACY], dopo: [Object.assign({}, LEGACY, { timbrata: true })] });
  const chip = page.locator('#mgRadici .mg-radice');
  await expect(chip).toHaveText('nato prima');
  await chip.click();
  await expect.poll(() => page.evaluate(() => window.__segna)).toEqual([{ type: 'fiducia_segna', radice: 'legacy' }]);
  await expect(page.locator('#mgManageMsg')).toContainText('«nato prima» timbrata: 3 cose hanno cambiato fiducia.');
  await expect(page.locator('#mgFiduciaBtn')).toHaveText('🤝 Fidato');
  await expect(page.locator('#mgRadici .mg-radice')).toHaveText('✓ nato prima');
  await expect(page.locator('#mgRadici .mg-radice')).toHaveAttribute('aria-pressed', 'true');
});

test('su una radice timbrata un clic toglie il timbro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const timbrata = Object.assign({}, UTENTE, { timbrata: true });
  await apri(page, [fb()], { radici: [timbrata, LEGACY] });
  const chip = page.locator('#mgRadici .mg-radice').first();
  await expect(chip).toHaveText('✓ #1916');
  await expect(chip).toHaveAttribute('title', /un clic toglie il timbro, ovunque/);
  await chip.click();
  await expect.poll(() => page.evaluate(() => window.__segna)).toEqual([{ type: 'fiducia_segna', radice: 'feedback:1916', fidato: false }]);
  await expect(page.locator('#mgManageMsg')).toContainText('Timbro tolto a «#1916»');
});

test('un server che non sa dire le radici: niente cartellino, il tasto resta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], { radici: null });
  await expect(page.locator('#mgFiduciaBtn')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__lette)).toBeGreaterThan(0);
  await expect(page.locator('#mgRadici')).toBeHidden();
});

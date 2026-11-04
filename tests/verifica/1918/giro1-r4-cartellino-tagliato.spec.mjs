// Giro 1 della verifica #1918, rilievo 4: le radici accanto a «Segna fidato» si vedono tutte senza scorrere di lato
// la fila dei tasti. I dati finti sono quelli dello spec del cartellino.

import { test, expect } from '../../fixtures/electron.mjs';

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

test('r4 con cinque radici il cartellino si vede tutto, senza scorrere la fila dei tasti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [fb()], { radici: [UTENTE, LEGACY, IGNOTA, PAGINA, SESSIONE] });
  const chips = page.locator('#mgRadici .mg-radice');
  await expect(chips).toHaveCount(5);
  for (let i = 0; i < 5; i += 1) await expect(chips.nth(i), `la radice ${i + 1} sta nella parte visibile`).toBeInViewport({ ratio: 1 });
  const fuori = await page.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll('#mgRadici .mg-radice')) {
      const r = c.getBoundingClientRect();
      for (let p = c.parentElement; p && p !== document.body; p = p.parentElement) {
        const q = p.getBoundingClientRect();
        if (getComputedStyle(p).overflowX !== 'visible' && (r.right > q.right + 1 || r.left < q.left - 1)) { out.push(c.textContent); break; }
      }
    }
    return out;
  });
  expect(fuori, 'radici tagliate dal riquadro dei tasti').toEqual([]);
});

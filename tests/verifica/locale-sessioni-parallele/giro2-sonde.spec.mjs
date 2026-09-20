// Giro 2, sonde: porte nuove sullo stesso riquadro (Gestione → Automazioni).
// Il giro 1 ha chiuso «valori inventati a lettura fallita» e «prioritario
// escluso senza avviso»: qui si guarda cosa resta scritto sullo schermo DOPO,
// e cosa succede quando due scelte partono a poca distanza l'una dall'altra.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

/**
 * Finto server (doc config/routines). `applicaPrimaDelRitardo` copia il vero
 * ordine delle cose: si scrive, si rilegge, e SOLO la risposta viaggia lenta.
 */
async function stub(page, doc = {}, opts = {}) {
  await page.evaluate(([init, o]) => {
    window.__doc = Object.assign({}, init);
    window.__getFail = !!o.getFail;
    window.__delaySet = o.delaySet || null;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        if (window.__getFail) return { ok: false, error: 'rete giù' };
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
      }
      if (msg && msg.type === 'automation_sessions_set') {
        const patch = {};
        for (const k of ['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']) {
          if (msg[k] != null) patch[k] = msg[k];
        }
        const esito = window.SN_ROUTINE_SESSIONI.valida(patch);
        if (!esito.ok) return { ok: false, error: esito.testo };
        Object.assign(window.__doc, esito.valori);
        const risposta = Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
        if (Array.isArray(window.__delaySet) && window.__delaySet.length) {
          const ms = window.__delaySet.shift();
          if (ms) await new Promise((r) => setTimeout(r, ms));
        }
        return risposta;
      }
      return orig(msg);
    };
  }, [doc, opts]);
}

async function apri(openTab, doc = {}, opts = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await stub(page, doc, opts);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

const pillola = (page, valore) => page.locator('.mg-auto-choice-item')
  .filter({ has: page.locator(`input[name="mgPriorityAccount"][value="${valore}"]`) });

const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);

test('una scelta fatta mentre la prima lettura è ancora per strada non viene riscritta da quella', async ({ openTab }) => {
  test.fail(true, 'rilievo del giro 2: la lettura di apertura arriva dopo e rimette lo stato di prima');
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await stub(page, {}, {});
  // La lettura di apertura ci mette un po', come su una rete lenta.
  await page.evaluate(() => {
    const prec = window.filo.message;
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        await new Promise((r) => setTimeout(r, 800));
      }
      return prec(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => { window.__mgTest.loadSessions(); });

  // L'owner non aspetta: esclude l'account A subito.
  await cambia(page, 'mgAccountA', false);
  await expect.poll(() => page.evaluate(() => window.__doc.accountAOff)).toBe(true);

  await page.waitForTimeout(1500);
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
});

test('dopo una lettura andata a buon fine non resta scritto che non si è potuto leggere', async ({ openTab }) => {
  test.fail(true, 'rilievo del giro 2: l\'avviso «non ho potuto leggere» resta anche quando i valori a schermo vengono dal server');
  // Prima apertura con la rete giù: le tre righe dicono «non ho potuto leggere».
  const page = await apri(openTab, { maxSessions: 9, accountAOff: true }, { getFail: true });
  await expect(page.locator('#mgAccountsMsg')).toContainText('Non ho potuto leggere');

  // Poi la rete torna e una scelta si salva: la risposta porta il documento
  // intero, e da quel momento quello che si vede VIENE dal server.
  await page.evaluate(() => { window.__getFail = false; });
  await pillola(page, 'A').click();
  await expect(page.locator('#mgPriorityAccountMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgMaxSessions')).toHaveValue('9');
  await expect(page.locator('#mgAccountA')).not.toBeChecked();

  // Le altre due righe non devono continuare a negare quello che ora è vero.
  await expect(page.locator('#mgAccountsMsg')).not.toContainText('Non ho potuto leggere');
  await expect(page.locator('#mgMaxSessionsMsg')).not.toContainText('Non ho potuto leggere');
});

test('due scelte a poca distanza: lo schermo non torna a dire il contrario del server', async ({ openTab }) => {
  test.fail(true, 'rilievo del giro 2: la risposta più vecchia arriva per ultima e riscrive lo schermo con lo stato di prima');
  // La prima risposta viaggia lenta, la seconda no: è il caso normale di due
  // scritture di fila su una rete che non risponde sempre allo stesso modo.
  const page = await apri(openTab, {}, { delaySet: [600, 0] });

  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await cambia(page, 'mgAccountA', false);

  // Sul server l'account A è escluso: lo schermo deve dirlo, non rimetterlo in uso.
  await expect.poll(() => page.evaluate(() => window.__doc.accountAOff)).toBe(true);
  await page.waitForTimeout(1200);
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
  await expect(page.locator('#mgMaxSessions')).toHaveValue('7');
});

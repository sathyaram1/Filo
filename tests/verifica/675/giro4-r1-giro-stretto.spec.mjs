// Giro 4, rilievo 1: nella stessa pagina il giro stretto (e i bilanci) non
// hanno la fila per impostazione, e una risposta vecchia riscrive lo schermo.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function stub(page, doc = {}, opts = {}) {
  await page.evaluate(([init, o]) => {
    window.__doc = Object.assign({ giroStretto: false }, init);
    window.__getFail = !!o.getFail;
    window.__setFail = 0;
    window.__delaySet = o.delaySet || null;
    window.__delayCaps = o.delayCaps || null;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        if (window.__getFail) return { ok: false, error: 'rete giù' };
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
      }
      if (msg && msg.type === 'automation_sessions_set') {
        if (window.__setFail > 0) { window.__setFail -= 1; return { ok: false, error: 'rete giù' }; }
        const patch = {};
        for (const k of ['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']) if (msg[k] != null) patch[k] = msg[k];
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
      if (msg && msg.type === 'automation_caps_set' && 'giroStretto' in msg && msg.giroStretto !== undefined) {
        window.__doc.giroStretto = msg.giroStretto;
        const risposta = { ok: true, giroStretto: msg.giroStretto };
        if (Array.isArray(window.__delayCaps) && window.__delayCaps.length) {
          const ms = window.__delayCaps.shift();
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

const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);

test('giro stretto acceso e spento di fila con la prima risposta lenta: lo schermo resta su quello che c\'è sul server', async ({ openTab }) => {
  const page = await apri(openTab, {}, { delayCaps: [600, 0] });
  await cambia(page, 'mgGiroStretto', true);
  await cambia(page, 'mgGiroStretto', false);
  await page.waitForTimeout(1200);
  const server = await page.evaluate(() => window.__doc.giroStretto);
  const schermo = await page.locator('#mgGiroStretto').isChecked();
  expect({ server, schermo }).toEqual({ server: false, schermo: false });
});

// Banco comune delle prove di #675: Gestione → Automazioni con un finto server nella pagina.
// Non è uno spec: lo importano le prove del giro.

const URL = 'filo://manage/manage.html';

export async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate(() => {
    window.__doc = {};
    window.__delaySet = [];
    window.__mappa = { owner: true, filo: true, claude: true, user: true };
    window.__delayAuto = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
      }
      if (msg && msg.type === 'automation_sessions_set') {
        const ms = window.__delaySet.shift();
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const patch = {};
        for (const k of ['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']) {
          if (msg[k] != null) patch[k] = msg[k];
        }
        Object.assign(window.__doc, window.SN_ROUTINE_SESSIONI.valida(patch).valori);
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
      }
      if (msg && msg.type === 'automation_set' && msg.autoApprove) {
        // Come il main: legge la mappa intera, un giro di rete, la riscrive intera.
        const letta = Object.assign({}, window.__mappa);
        const ms = window.__delayAuto.shift();
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const next = Object.assign(letta, msg.autoApprove);
        window.__mappa = next;
        return { ok: true, enabled: false, autoApprove: Object.assign({}, next), proberWhenIdle: false, routinesEnabled: true };
      }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

export const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);


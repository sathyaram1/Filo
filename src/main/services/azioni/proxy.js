// Le azioni di Filo sul proxy per paese delle schede e dei domini.
// Ogni file esporta la tabella tipo -> funzione che eseguiAzioneFilo (handlers.js) consulta dopo il preambolo.

const { winOf, targetWebTab, refreshProxyRulesAllWindows } = require('../handlersComuni');
const { proxyNonDisponibile } = require('../osservazioniPerModello');

// ── proxy per-tab via linguaggio naturale (#152) ───────────────────────
// Le primitive sono le STESSE della UI (tasto destro sulla tab): l'agente
// chiama setTabProxy/clearTabProxy/regole-per-dominio del TabManager.
async function azioneProxyTab(action, { sender }) {
  // Eseguita subito (livello 1, reversibile): il testo della risposta è già la conferma,
  // quindi kept:false e nella bolla non resta nessuna azione.
  const { tm, tab } = targetWebTab(sender);
  if (tm && !(await tm.proxyAvailable())) return { executed: false, kept: false, output: proxyNonDisponibile() };
  if (!tm || !tab) return { executed: false, kept: false, output: { proxy: 'no_web_tab' } };
  const r = await tm.setTabProxy(tab.id, action.country ?? action.paese ?? action.codicePaese ?? action.location);
  if (r && r.error === 'not_configured') return { executed: false, kept: false, output: proxyNonDisponibile() };
  return {
    executed: !!(r && r.ok),
    kept: false,
    output: { proxy: r && r.ok ? 'on' : (r && r.error) || 'failed', country: r && r.country },
  };
}

async function azioneRimuoviProxy(action, { sender }) {
  const { tm, tab } = targetWebTab(sender);
  if (!tm || !tab) return { executed: false, kept: false };
  const r = tm.clearTabProxy(tab.id);
  return { executed: !!(r && r.ok), kept: false };
}

async function azioneRimuoviProxyTutte(action, { sender }) {
  const win = winOf(sender);
  const tm = win && win._filoTabs;
  if (!tm) return { executed: false, kept: false };
  const count = tm.clearAllProxies();
  return { executed: true, kept: false, output: { proxy: 'cleared_all', count } };
}

async function azioneRegolaProxyDominio(action, { sender }) {
  const { tm, tab } = targetWebTab(sender);
  if (!tm) return { executed: false, kept: false };
  const country = action.country ?? action.paese ?? action.codicePaese ?? action.location;
  // Dominio esplicito dall'LLM, altrimenti quello della scheda web attiva.
  const domain = action.dominio ?? action.domain ?? action.sito ?? (tab ? tab.url : '');
  const r = await tm.setDomainProxyRule(country, { domain });
  if (r && r.error === 'not_configured') return { executed: false, kept: false, output: proxyNonDisponibile() };
  if (r && r.ok) refreshProxyRulesAllWindows();
  return {
    executed: !!(r && r.ok),
    kept: false,
    output: r && r.ok ? { proxyRule: 'set', domain: r.domain, country: r.country } : { proxyRule: 'failed', error: r && r.error },
  };
}

async function azioneRimuoviRegolaProxy(action, { sender }) {
  const { tm, tab } = targetWebTab(sender);
  if (!tm) return { executed: false, kept: false };
  const domain = action.dominio ?? action.domain ?? action.sito ?? (tab ? tab.url : '');
  const r = await tm.removeDomainProxyRule({ domain });
  if (r && r.ok) refreshProxyRulesAllWindows();
  return {
    executed: !!(r && r.ok),
    kept: false,
    output: r && r.ok ? { proxyRule: 'removed', domain: r.domain } : { proxyRule: 'failed' },
  };
}

module.exports = {
  PROXY_TAB: azioneProxyTab,
  RIMUOVI_PROXY: azioneRimuoviProxy,
  RIMUOVI_PROXY_TUTTE: azioneRimuoviProxyTutte,
  REGOLA_PROXY_DOMINIO: azioneRegolaProxyDominio,
  RIMUOVI_REGOLA_PROXY: azioneRimuoviRegolaProxy,
};

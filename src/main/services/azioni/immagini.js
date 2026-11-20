// Le azioni di Filo sulle immagini delle risposte (#2272): trovarle sul web e crearle con un modello.
// Esporta la tabella tipo -> funzione che eseguiAzioneFilo consulta; il lavoro vero sta in ../immaginiDelleRisposte.js.

const ImmaginiChat = require('../immaginiDelleRisposte');
const { getEffectiveSettings, Gate } = require('../impostazioniEffettive');

const testoDi = (action, ...campi) => String(campi.map((c) => action[c]).find((v) => v != null && String(v).trim()) ?? '').trim();

async function azioneImmaginiWeb(action) {
  const query = globalThis.SN_ACTION_LEVELS.ricercaImmaginiDi(action);
  if (!query) return { executed: false, kept: true, output: { cerca: '', immagini: [], error: 'ricerca vuota' } };
  try {
    const settings = await getEffectiveSettings();
    const r = await ImmaginiChat.cerca(query, { tavilyKey: (settings.apiKeys && settings.apiKeys.tavily) || '' });
    return { executed: r.ok, kept: true, output: { cerca: query, immagini: r.immagini, provider: r.provider || '', ...(r.reason ? { reason: r.reason } : {}) } };
  } catch (e) {
    return { executed: false, kept: true, output: { cerca: query, immagini: [], error: (e && e.message) || String(e) } };
  }
}

async function azioneGeneraImmagine(action) {
  const descrizione = testoDi(action, 'descrizione', 'prompt', 'testo', 'query');
  if (!descrizione) return { executed: false, kept: true, output: { descrizione: '', immagini: [], error: 'descrizione vuota' } };
  try {
    const settings = await getEffectiveSettings();
    const r = await ImmaginiChat.genera(descrizione, { settings, gate: Gate });
    return {
      executed: r.ok, kept: true,
      output: {
        descrizione, immagini: r.immagini,
        ...(r.reason ? { reason: r.reason } : {}), ...(r.senzaModello ? { senzaModello: true } : {}), ...(r.testo ? { testo: r.testo } : {}),
      },
    };
  } catch (e) {
    return { executed: false, kept: true, output: { descrizione, immagini: [], error: (e && e.message) || String(e) } };
  }
}

module.exports = {
  IMMAGINI_WEB: azioneImmaginiWeb,
  GENERA_IMMAGINE: azioneGeneraImmagine,
};

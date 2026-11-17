// Le azioni di Filo su timer, sveglie ed eventi del calendario.
// Ogni file esporta la tabella tipo -> funzione che eseguiAzioneFilo (handlers.js) consulta dopo il preambolo.

const FiloMem = globalThis.SN_FILO_MEMORY;
const { broadcastLiveUpdate } = require('../broadcast');
const { timerRefOf, describeTimerEntry, cleanLabel } = require('../porteUscita');

async function azioneTimer(action, { chatId }) {
  const seconds = Number(action.seconds || action.secondi || 0);
  const label = cleanLabel(action.label || action.etichetta) || 'Timer';
  // La conversazione che l'ha chiesto: la carta del timer nella home la riapre (#870).
  const entry = await FiloMem.addTimer({ label, seconds, chat: chatId });
  if (entry) broadcastLiveUpdate();
  return { executed: !!entry, kept: !!entry };
}

async function azioneSveglia(action, { chatId }) {
  // La sveglia entra nei timer con scadenza assoluta e riusa il flusso della suoneria.
  const entry = await FiloMem.addAlarm({
    label: cleanLabel(action.label ?? action.etichetta),
    time: action.time ?? action.orario ?? action.at ?? '',
    repeat: action.ripeti ?? action.repeat ?? action.giorni ?? action.days,
    chat: chatId,
  });
  if (entry) broadcastLiveUpdate();
  return { executed: !!entry, kept: !!entry };
}

async function azioneCancellaSveglia(action) {
  // Riferimento non capito: non si cancella niente, `removed` vuoto e il modello chiede
  // quale.
  const ids = Array.isArray(action._targetIds) ? action._targetIds : null;
  const r = await FiloMem.removeTimersByRef(ids ? { ids } : timerRefOf(action));
  const removed = r.removed || [];
  if (removed.length) broadcastLiveUpdate();
  // `kept`: se una sveglia si mette dalla chat, si deve vedere anche quando la si toglie.
  return {
    executed: removed.length > 0,
    kept: removed.length > 0,
    output: { removed: removed.map(describeTimerEntry) },
  };
}

async function azioneModificaSveglia(action) {
  const ids = Array.isArray(action._targetIds) ? action._targetIds : null;
  const r = await FiloMem.updateTimersByRef(ids ? { ids } : timerRefOf(action), {
    time: action.orario ?? action.time ?? action.at ?? action.nuovoOrario,
    repeat: action.ripeti ?? action.repeat ?? action.giorni ?? action.days,
    seconds: action.secondi ?? action.seconds,
  });
  const updated = r.updated || [];
  if (updated.length) broadcastLiveUpdate();
  return {
    executed: updated.length > 0,
    kept: updated.length > 0,
    output: { updated: updated.map(describeTimerEntry) },
  };
}

async function azioneEventoCalendario(action) {
  // Filo PROPONE: nel calendario l'evento entra col bottone. `proposta`
  // lo dice alla chat, che senza lo racconterebbe come non riuscito; data
  // e ora si controllano qui, non nel calendario dell'utente.
  const C = globalThis.SN_CALENDAR;
  const v = C ? C.verifica(action) : { errore: 'calendario non disponibile' };
  if (!v.evento) return { executed: false, kept: false, output: { event: 'invalid', error: v.errore } };
  return { executed: false, kept: true, output: { proposta: true, evento: v.evento } };
}

module.exports = {
  TIMER: azioneTimer,
  SVEGLIA: azioneSveglia,
  CANCELLA_SVEGLIA: azioneCancellaSveglia,
  MODIFICA_SVEGLIA: azioneModificaSveglia,
  EVENTO_CALENDARIO: azioneEventoCalendario,
};

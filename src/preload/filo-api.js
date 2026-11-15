// window.filo delle pagine filo://: la superficie che parla col main via IPC. Non si espone da qui:
// lo fa internal-preload.js, e solo su origine filo:. I comandi della shell stanno in filo-api-shell.js.
const montaShell = require('./filo-api-shell.js');

module.exports = function creaFiloApi(ipcRenderer, webUtils) {
  let streamCounter = 0;
  const nuovoNumero = () => ++streamCounter;

  return {
    message: (msg) => ipcRenderer.invoke('filo:message', msg),
    getURL: (rel) => 'filo://' + String(rel || '').replace(/^\/+/, ''),
    // 'darwin' | 'win32' | 'linux': le pagine devono nominare il tasto giusto e
    // offrire le shell che esistono davvero. Dato del sistema, non dell'utente.
    sistema: process.platform,
    // Il percorso su disco di un file trascinato in una pagina di Filo (#950): '' se non viene dal disco.
    percorsoDelFile: (file) => {
      try { return (webUtils && webUtils.getPathForFile(file)) || ''; } catch (_) { return ''; }
    },
    onBroadcast: (fn) => {
      const wrapped = (_event, msg) => { try { fn(msg); } catch (_) {} };
      ipcRenderer.on('filo:broadcast', wrapped);
      return () => ipcRenderer.removeListener('filo:broadcast', wrapped);
    },
    // { reqId, text }: il chiamante filtra per reqId. Ritorna un unsubscribe.
    onReasoning: (fn) => {
      const wrapped = (_event, data) => { try { fn(data); } catch (_) {} };
      ipcRenderer.on('filo:reasoning', wrapped);
      return () => ipcRenderer.removeListener('filo:reasoning', wrapped);
    },
    // #420 — { reqId, delta } coi caratteri nuovi, oppure { reqId, reset: true }
    // quando il ripiego impone di buttare il testo mostrato finora.
    onAnswer: (fn) => {
      const wrapped = (_event, data) => { try { fn(data); } catch (_) {} };
      ipcRenderer.on('filo:answer', wrapped);
      return () => ipcRenderer.removeListener('filo:answer', wrapped);
    },
    // Le AZIONI in diretta durante una FILO_CHAT (tool calling nativo). Il main
    // pusha sul canale 'filo:action' { reqId, kind, ... }: kind 'start' (il
    // modello ha appena nominato un'azione: { type }), 'done' (eseguita, con
    // l'azione completa di esito: { action }) e 'round' (un giro con azioni si è
    // chiuso: il testo scritto in quel giro è una nota di lavoro, non la
    // risposta: { text }; con `risposta: true` è un giro di soli bottoni e il
    // testo apre la risposta) e 'fine' (l'ultimo della diretta, #1321). Il chiamante filtra per reqId. Ritorna un unsubscribe.
    onAction: (fn) => {
      const wrapped = (_event, data) => { try { fn(data); } catch (_) {} };
      ipcRenderer.on('filo:action', wrapped);
      return () => ipcRenderer.removeListener('filo:action', wrapped);
    },
    // #590 — una pagina aperta da NAVIGA che, a turno finito, si è spostata da sé su un sito
    // della lista: { callId, host, reason, url }. Ritorna un unsubscribe.
    onAperturaFermata: (fn) => {
      const wrapped = (_event, data) => { try { fn(data); } catch (_) {} };
      ipcRenderer.on('filo:apertura-fermata', wrapped);
      return () => ipcRenderer.removeListener('filo:apertura-fermata', wrapped);
    },
    aiStream: ({ action, payload, onMeta, onDelta, onReset, onDone, onError }) => {
      const requestId = `s${Date.now()}_${nuovoNumero()}`;
      const offMeta = (_e, data) => onMeta && onMeta(data);
      const offDelta = (_e, data) => onDelta && onDelta(data.delta);
      // #273 — reset: il provider è caduto a metà, i delta accumulati si buttano.
      const offReset = (_e, data) => onReset && onReset(data);
      const offDone = (_e, data) => { cleanup(); onDone && onDone(data); };
      const offError = (_e, data) => { cleanup(); onError && onError(data); };
      const cleanup = () => {
        ipcRenderer.removeListener(`ai-stream:${requestId}:meta`, offMeta);
        ipcRenderer.removeListener(`ai-stream:${requestId}:delta`, offDelta);
        ipcRenderer.removeListener(`ai-stream:${requestId}:reset`, offReset);
        ipcRenderer.removeListener(`ai-stream:${requestId}:done`, offDone);
        ipcRenderer.removeListener(`ai-stream:${requestId}:error`, offError);
      };
      ipcRenderer.on(`ai-stream:${requestId}:meta`, offMeta);
      ipcRenderer.on(`ai-stream:${requestId}:delta`, offDelta);
      ipcRenderer.on(`ai-stream:${requestId}:reset`, offReset);
      ipcRenderer.on(`ai-stream:${requestId}:done`, offDone);
      ipcRenderer.on(`ai-stream:${requestId}:error`, offError);
      ipcRenderer.invoke('ai-stream:start', { requestId, action, payload });
      return {
        abort: () => { ipcRenderer.send('ai-stream:abort', { requestId }); cleanup(); },
      };
    },
    ...montaShell(ipcRenderer, nuovoNumero),
    // Questo "/dominio.tld" risolve davvero? Per colorare di rosso (e non
    // navigare verso) un sito inesistente dalla barra comando della dashboard.
    siteResolves: (opts) => ipcRenderer.invoke('net:resolves', opts),
  };
};

// I comandi della shell di window.filo (modalità terminale della dashboard): li unisce filo-api.js.
// `nuovoNumero` è il contatore comune con aiStream, così ogni flusso aperto dalla pagina ha un id suo.
module.exports = function creaFiloApiShell(ipcRenderer, nuovoNumero) {
  return {
    // Esecuzione shell (modalità terminale della dashboard), gemella di aiStream.
    // onData({chunk, stream}), onExit({code, cwd}), onError({message}).
    // Ritorna { sendInput(text), abort() }.
    shellExec: ({ command, cwd, shell, chat, gettone, daFuori, onData, onExit, onError }) => {
      const execId = `sh${Date.now()}_${nuovoNumero()}`;
      const offData = (_e, data) => onData && onData(data);
      const offExit = (_e, data) => { cleanup(); onExit && onExit(data); };
      const offError = (_e, data) => { cleanup(); onError && onError(data); };
      const cleanup = () => {
        ipcRenderer.removeListener(`shell:${execId}:data`, offData);
        ipcRenderer.removeListener(`shell:${execId}:exit`, offExit);
        ipcRenderer.removeListener(`shell:${execId}:error`, offError);
      };
      ipcRenderer.on(`shell:${execId}:data`, offData);
      ipcRenderer.on(`shell:${execId}:exit`, offExit);
      ipcRenderer.on(`shell:${execId}:error`, offError);
      ipcRenderer.invoke('shell:start', { execId, command, cwd, shell, chat, gettone, daFuori: daFuori === true });
      return {
        sendInput: (text) => ipcRenderer.send('shell:input', { execId, text }),
        abort: () => { ipcRenderer.send('shell:abort', { execId }); cleanup(); },
      };
    },
    shellHome: () => ipcRenderer.invoke('shell:home'),
    // #892.1 — cosa chiede un comando scritto a mano prima di partire, coi livelli di quelli di Filo; il no della persona.
    shellVaglia: (opts) => ipcRenderer.invoke('shell:vaglia', opts),
    shellAnnulla: (gettone) => ipcRenderer.send('shell:annulla', { gettone }),
    shellWhich: (opts) => ipcRenderer.invoke('shell:which', opts),
    // #968 — le virgolette a un percorso con spazi: appena incollato nel comando, e proposte dopo un errore.
    shellVirgoletteIncolla: (opts) => ipcRenderer.invoke('shell:virgolette-incolla', opts),
    shellPropostaVirgolette: (opts) => ipcRenderer.invoke('shell:proposta-virgolette', opts),
  };
};

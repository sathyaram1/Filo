// Avviso a una pagina interna che sta per sparire, e attesa della sua risposta.
// NON serve a chiedere permesso: la chiusura avviene comunque, al più tardi al tetto.
// La regola sta in tests/unit/congedoPagina.test.mjs.

const { ipcMain } = require('electron');

// Una scheda distrutta non riceve `pagehide`: Electron butta via la view e il
// renderer non vede niente (verificato sul campo). Le pagine di Filo che
// aspettano qualche centinaio di ms prima di salvare perdevano così l'ultima
// modifica, e la chat della home restava aperta invece di chiudersi.
const CANALE_AVVISO = 'filo:pagina-sparisce';
const CANALE_RISPOSTA = 'filo:pagina-sparita';

// Il tetto è largo di proposito: il costo di aspettare è qualche decimo di
// secondo su una view già tolta dallo schermo, quello di non aspettare è il
// lavoro di chi scriveva. Una pagina che non risponde non blocca nessuno.
const TETTO_MS = 800;

function congedaPagina(webContents, { tetto = TETTO_MS } = {}) {
  return new Promise((risolvi) => {
    let fatto = false;
    let timer = null;
    const fine = () => {
      if (fatto) return;
      fatto = true;
      clearTimeout(timer);
      try { ipcMain.removeListener(CANALE_RISPOSTA, ascolta); } catch (_) {}
      risolvi();
    };
    // Solo la risposta di QUESTA pagina conta: due schede che si chiudono
    // insieme si sbloccherebbero a vicenda senza aver salvato.
    const ascolta = (event) => { if (event && event.sender === webContents) fine(); };
    let vivo = false;
    try { vivo = !!webContents && !webContents.isDestroyed(); } catch (_) { vivo = false; }
    if (!vivo) { risolvi(); return; }
    ipcMain.on(CANALE_RISPOSTA, ascolta);
    timer = setTimeout(fine, tetto);
    timer.unref?.();
    try { webContents.send(CANALE_AVVISO); } catch (_) { fine(); }
  });
}

module.exports = { congedaPagina, CANALE_AVVISO, CANALE_RISPOSTA, TETTO_MS };

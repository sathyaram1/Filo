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

// Un ascoltatore solo per tutte le attese: «chiudi tutto» con una ventina di
// schede ne registrerebbe una ventina, e sopra la decina Node avvisa di una
// perdita di memoria che qui non c'è.
const inAttesa = new Map();
let ascoltoAcceso = false;

function accendiAscolto() {
  if (ascoltoAcceso) return;
  ascoltoAcceso = true;
  // Solo la risposta di QUELLA pagina la sblocca: due schede che si chiudono
  // insieme si sbloccherebbero a vicenda senza aver salvato.
  ipcMain.on(CANALE_RISPOSTA, (event) => {
    const fine = event && inAttesa.get(event.sender);
    if (fine) fine();
  });
}

function congedaPagina(webContents, { tetto = TETTO_MS } = {}) {
  return new Promise((risolvi) => {
    let vivo = false;
    try { vivo = !!webContents && !webContents.isDestroyed(); } catch (_) { vivo = false; }
    if (!vivo) { risolvi(); return; }
    accendiAscolto();
    let timer = null;
    const fine = () => {
      if (!inAttesa.has(webContents)) return;
      inAttesa.delete(webContents);
      clearTimeout(timer);
      risolvi();
    };
    inAttesa.set(webContents, fine);
    // Il timer NON si sgancia dal giro degli eventi: è l'unica garanzia che la
    // view venga poi buttata via anche se la pagina non risponde mai.
    timer = setTimeout(fine, tetto);
    try { webContents.send(CANALE_AVVISO); } catch (_) { fine(); }
  });
}

module.exports = { congedaPagina, CANALE_AVVISO, CANALE_RISPOSTA, TETTO_MS };

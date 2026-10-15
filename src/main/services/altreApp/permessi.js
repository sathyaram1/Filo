// I permessi del sistema che servono al driver. Su Mac il driver gira dentro i permessi di Filo (modo incorporato), quindi
// Accessibilità e Registrazione schermo li chiede Filo, aprendo il pannello giusto. Windows non ne chiede; su Linux quello
// che manca (l'accessibilità del desktop) lo sa dire solo il driver, e lo riporta la sua prova.
'use strict';

const PANNELLI_MAC = {
  accessibilita: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  schermo: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

const NOMI = {
  accessibilita: { nome: 'Accessibilità', frase: 'Su Mac serve il permesso «Accessibilità» per Filo, per leggere e toccare le finestre.' },
  schermo: { nome: 'Registrazione schermo', frase: 'Su Mac serve il permesso «Registrazione schermo» per Filo, per vedere le finestre.' },
  atspi: { nome: 'Accessibilità del desktop', frase: 'L\'accessibilità del desktop è spenta, e senza Filo non legge le finestre: si accende dalle impostazioni di accessibilità del sistema.' },
  display: { nome: 'Sessione X11', frase: 'Il componente vede le finestre in una sessione X11: in questa sessione non le raggiunge.' },
};

function voce(id, apribile) {
  return { id, nome: NOMI[id].nome, frase: NOMI[id].frase, apribile };
}

/** I permessi che mancano adesso, ognuno con nome, frase e se Filo sa aprire il pannello. `electron` si inietta nelle prove. */
function mancanti({ platform = process.platform, electron = () => require('electron'), daLinux = [] } = {}) {
  if (platform === 'darwin') {
    const { systemPreferences } = electron();
    const out = [];
    let ax = false;
    let schermo = 'not-determined';
    try { ax = systemPreferences.isTrustedAccessibilityClient(false); } catch (_) {}
    try { schermo = systemPreferences.getMediaAccessStatus('screen'); } catch (_) {}
    if (!ax) out.push(voce('accessibilita', true));
    if (schermo !== 'granted') out.push(voce('schermo', true));
    return out;
  }
  if (platform === 'linux') return daLinux.filter((id) => NOMI[id]).map((id) => voce(id, false));
  // Windows: UI Automation non chiede permessi a un programma dello stesso utente.
  return [];
}

/** Chiede un permesso su Mac: il sistema mostra la sua richiesta e Filo apre il pannello dove si concede. */
async function chiedi(id, { platform = process.platform, electron = () => require('electron') } = {}) {
  if (platform !== 'darwin') return { ok: false, motivo: 'su questo sistema Filo non ha un pannello da aprire' };
  if (!PANNELLI_MAC[id]) return { ok: false, motivo: 'permesso sconosciuto' };
  const { systemPreferences, shell } = electron();
  if (id === 'accessibilita') { try { systemPreferences.isTrustedAccessibilityClient(true); } catch (_) {} }
  try { await shell.openExternal(PANNELLI_MAC[id]); } catch (_) { return { ok: false, motivo: 'il pannello non si apre' }; }
  return { ok: true };
}

module.exports = { mancanti, chiedi, PANNELLI_MAC };

// Le azioni di Filo sul computer: comandi, schermo, aggiornamento, volume e reti, desktop, finestra.
// Ogni file esporta la tabella tipo -> funzione che eseguiAzioneFilo (handlers.js) consulta dopo il preambolo.

const PageRead = require('../pageRead');
const Registro = require('../registroCambi');
const ContestoFilo = require('../contestoFilo');
const { SN_CONST, SN_MSG } = globalThis;
const { ACTIONS, PROMPTS } = SN_CONST;
const { Schermo, winOf } = require('../handlersComuni');
const { Gate } = require('../impostazioniEffettive');
const {
  getAssistantCwd, setAssistantCwd, chiaveSchermo, shellDeiComandi, richiestaDaEseguire,
} = require('../porteUscita');
const { dallaChat } = require('../autonomiaFonti');

async function azioneEseguiComando(action, { sender }) {
  // Si esegue il comando ESATTO classificato: mai una divergenza fra valutato e lanciato.
  const cmd = String(action.comando ?? action.command ?? action.cmd ?? '').trim();
  if (!cmd) return { executed: false, kept: true, output: { command: '', blocked: 'empty' } };
  const shell = (action._perimetro && action._perimetro.shell) || await shellDeiComandi();
  const { runCommand } = require('../terminal');
  // cwd PERSISTENTE: si parte dalla cartella corrente e si cattura quella risultante, così
  // un `cd` resta valido per il comando dopo e il client aggiorna la barra.
  const cwd = getAssistantCwd(sender);
  const out = await runCommand(cmd, { shell, cwd, trackCwd: true });
  if (out.cwd) setAssistantCwd(sender, out.cwd);
  PageRead.ricordaLetturaRiservata(`${out.stdout || ''}\n${out.stderr || ''}`);
  return { executed: out.code === 0, kept: true, output: out };
}

async function azioneVediSchermo(action, { sender, chatId, segnale, domanda }) {
  // L'immagine va solo al modello di «Descrivi immagine», senza cronologia né cache: al giro torna testo (#778).
  // In memoria resta l'ultima della chat, che l'utente può allegare a una segnalazione (#1668).
  const CE = globalThis.SN_CHAT_ERRORS;
  let foto = null;
  const visto = await Schermo.guarda(action, {
    chiave: chiaveSchermo(sender),
    domanda,
    leggi: ({ dataUrl, finestra, domanda: chiesta, cosa }) => {
      foto = { dataUrl, nome: finestra };
      return Gate.text({
        action: ACTIONS.DESCRIBE_IMAGE,
        messages: PROMPTS.leggiSchermo({ dataUrl, finestra, domanda: chiesta, cosa }),
        ...(segnale ? { signal: segnale } : {}),
      });
    },
    fraseErrore: (e) => String((e && e.userMessage) || (CE && CE.friendly(e)) || ''),
  });
  const chatDellaFoto = chatId || (Registro.corrente() && Registro.corrente().chat) || '';
  if (visto && visto.executed && foto && chatDellaFoto) ContestoFilo.ricordaSchermata(chatDellaFoto, foto);
  return visto;
}

async function azioneInstallaAggiornamento(action) {
  // #786 — da spento è la stessa porta di «Installa» sulla carta; con una versione pronta riavvia (#1039).
  const r = await require('../../updater').aggiornaDaChat({ riavvio: action._riavvio === true });
  const aggiornamento = r.aggiornamento || { pronto: 'pronta' }[r.esito] || r.esito;
  return {
    executed: r.eseguito === true,
    kept: false,
    output: { aggiornamento, versione: r.versione || null, frase: r.frase, ...(r.eseguito === true ? {} : { error: r.frase }) },
  };
}

async function azioneVolumeBluetoothWifi(action, { type }) {
  // #874 — la stessa porta dei tasti della home (MSG.SISTEMA_COMANDA): due cammini, un risultato.
  const r = await require('../comandiSistema').comanda(richiestaDaEseguire(type, action));
  return { executed: !!r.ok, kept: false, output: r };
}

async function azioneOrdinaDesktop(action) {
  const r = await require('../iconeDesktop').ordinaIcone(action);
  return { executed: !!r.ok, kept: false, output: r };
}

async function azioneComandoFinestra(action, { sender }) {
  // #419 — l'agente della home aziona i controlli del browser Filo (schermo
  // intero, riduci a icona, menu Impostazioni/App/Account, home): prima poteva
  // solo spiegare a parole come cliccarli. "close" è escluso di proposito.
  const { COMANDI_CHAT } = require('../../barraLaterale');
  const allowed = ['home', 'settings', 'apps', 'account', 'minimize', 'fullscreen', 'aiuto', ...Object.keys(COMANDI_CHAT)];
  const cmd = String(action.comando ?? action.command ?? action.cmd ?? '').trim().toLowerCase();
  if (!allowed.includes(cmd)) {
    return { executed: false, kept: false, output: { window: 'invalid', command: cmd } };
  }
  const win = winOf(sender);
  if (!win) return { executed: false, kept: false };
  // Chi è già nella home non ci si porta: ricaricarla butterebbe via il
  // lavoro e la risposta prima che l'utente li legga (il bottone che
  // chiude la conversazione lo mette la chat).
  if (cmd === 'home' && /^filo:\/\/(newtab|dashboard)\b/i.test(String(sender?.tab?.url || sender?.url || ''))) {
    return { executed: true, kept: true, output: { window: 'home', already: true } };
  }
  // Da quale strada (#1468): l'Aiuto lo conta chi lo apre.
  const Strade = require('../contatoriStrade');
  const azioneStrada = dallaChat() ? { fullscreen: 'fullscreen', home: 'home', sidebar: 'barra_laterale' }[cmd] : '';
  if (azioneStrada) Strade.misura('azione', azioneStrada, 'chat', { incognito: !!win._filoIncognito });
  if (azioneStrada === 'home') Strade.misura('pagina', 'filo://newtab/', 'chat', { finestra: win._filoTabs, incognito: !!win._filoIncognito });
  if (cmd === 'fullscreen') {
    // Schermo intero «immersivo»: la view attiva copre la finestra e le barre spariscono.
    // NON preme il pulsante del lettore video: Filo non ha accesso ai comandi del sito.
    if (win._filoTabs && typeof win._filoTabs.toggleContentFullscreen === 'function') {
      win._filoTabs.toggleContentFullscreen();
    } else if (typeof win.setFullScreen === 'function') {
      win.setFullScreen(!win.isFullScreen());
    }
    return { executed: true, kept: false, output: { window: 'fullscreen' } };
  }
  // #871, #1292 — la barra laterale chiesta in chat resta aperta finché la si chiude, come da tastiera; la chat la
  // chiude anche bloccata, e la blocca o la sblocca (#1431).
  if (COMANDI_CHAT[cmd]) {
    if (!win._filoTabs?.barra) return { executed: false, kept: false };
    const r = await win._filoTabs.barra.comandoChat(cmd);
    return { executed: true, kept: false, output: { window: cmd, ...(r && r.gia ? { gia: true } : {}) } };
  }
  // #1433 — l'Aiuto chiesto in chat si apre sulla scheda davanti come col suo tasto: nell'Editor è la chat del documento.
  if (cmd === 'aiuto') {
    require('../../shortcuts').dispatch('open-help-sidebar', win, dallaChat() ? 'chat' : '');
    return { executed: true, kept: false, output: { window: 'aiuto' } };
  }
  // home / minimize / settings / apps / account: clicca il bottone REALE
  // della shell, riusando il canale dei comandi rapidi della barra (stessa
  // via dell'assistente di pagina, MSG.SHELL_ACTION) così si riusa tutto il
  // comportamento esistente (menu ancorati, toggle finestra…).
  try { win.webContents.send('shell:trigger-button', { command: cmd }); }
  catch (_) { return { executed: false, kept: false }; }
  return { executed: true, kept: false, output: { window: cmd } };
}

module.exports = {
  ESEGUI_COMANDO: azioneEseguiComando,
  VEDI_SCHERMO: azioneVediSchermo,
  INSTALLA_AGGIORNAMENTO: azioneInstallaAggiornamento,
  VOLUME: azioneVolumeBluetoothWifi,
  BLUETOOTH: azioneVolumeBluetoothWifi,
  WIFI: azioneVolumeBluetoothWifi,
  ORDINA_DESKTOP: azioneOrdinaDesktop,
  COMANDO_FINESTRA: azioneComandoFinestra,
};

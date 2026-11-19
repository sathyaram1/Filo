// Il doppio Ctrl (#2377): riconosce i tocchi da ogni webContents di Filo (shortcuts.collegaScorciatoie), apre il box
// delle lettere e fa l'azione con la stessa funzione del suo tasto, del suo menu o della chat, mai una copia.
// Logica dei tocchi e lettere: src/shared/doppioCtrl.js. Prove: tests/doppio-ctrl.spec.mjs.

require('../shared/doppioCtrl');
const Box = require('./boxDelleLettere');

const D = globalThis.SN_DOPPIO_CTRL;
const MAC = process.platform === 'darwin';
const USATE = 'sn_doppio_ctrl_usate';
// Fra la richiesta del box e la sua comparsa (la finestra si sta caricando) le lettere vanno ancora al gesto.
const ATTESA_BOX_MS = 2000;

const tocchi = D.riconoscitore();
let cfg = D.normalizza(null);
let blocklist = [];
let attesa = null;
let usate = null;
let apertoAlle = 0;

function configura(settings) {
  cfg = D.normalizza(settings && settings.doppioCtrl);
  blocklist = Array.isArray(settings && settings.blocklist) ? settings.blocklist : [];
  if (!cfg.acceso) { fermaAttesa(); tocchi.chiuso(); }
}

function fermaAttesa() {
  if (attesa) clearTimeout(attesa.timer);
  attesa = null;
}

// Il sito che usa Ctrl per sé (giochi, desktop remoti) lo si toglie col tasto che spegne Filo su quel sito.
function spentoSu(wc) {
  if (!blocklist.length) return false;
  let url = '';
  try { url = String(wc.getURL() || ''); } catch (_) { return false; }
  if (!/^https?:/i.test(url)) return false;
  try { return require('./services/handlers/filoSpento').vociCheSpengono(blocklist, [url]).length > 0; } catch (_) { return false; }
}

const finestra = (f) => require('./shortcuts').finestraDiFilo(typeof f === 'function' ? f() : f);

// Da before-input-event: true se il tasto era del gesto e la pagina non deve vederlo.
function tasto(wc, event, input, f) {
  if (!cfg.acceso || !input || (input.type !== 'keyDown' && input.type !== 'keyUp')) return false;
  const delBox = Box.eDelBox(wc);
  if (!delBox && spentoSu(wc)) return false;
  const t = Date.now();
  const delTocco = input.key === 'Control' || (MAC && input.key === 'Meta');
  let e = null;
  if (delTocco) e = { tipo: input.type === 'keyDown' ? 'giu' : 'su', t, repeat: !!input.isAutoRepeat };
  else if (input.type === 'keyDown') {
    // Il box chiesto ma non ancora davanti: la lettera battuta in quell'istante è sua, non della pagina. Un box che
    // non arriva non si tiene le lettere di chi scrive.
    if (!delBox && tocchi.fase() === 'aperto') {
      if (t - apertoAlle <= ATTESA_BOX_MS) return primaDelBox(event, input, f);
      Box.chiudi(finestra(f), 'fuoco');
      tocchi.chiuso();
    }
    e = { tipo: 'tasto', key: input.key, code: input.code, t, mod: { ctrl: !!input.control, meta: !!input.meta, alt: !!input.alt, shift: !!input.shift } };
  } else return false;
  const esito = tocchi.evento(e, cfg);
  if (!esito) return false;
  if (esito === 'chiudi') { Box.chiudi(delBox || finestra(f), 'tocco'); tocchi.chiuso(); return false; }
  if (esito.attendi) {
    fermaAttesa();
    const win = finestra(f);
    // La finestra del box nasce adesso, mentre si aspetta: quando serve è già carica.
    if (win) Box.preparaBox(win);
    attesa = { timer: setTimeout(() => { attesa = null; if (tocchi.scaduto() === 'apri') apriBox(win); }, esito.attendi) };
    return false;
  }
  fermaAttesa();
  if (esito === 'annulla') return false;
  if (esito.annulla) { event.preventDefault(); return true; }
  if (esito.lettera) {
    event.preventDefault();
    const win = finestra(f);
    const v = D.diLettera(cfg, esito.lettera);
    if (v) esegui(v.id, win);
    // Una lettera che non fa niente mostra subito quelle che fanno qualcosa.
    else apriBox(win);
    return true;
  }
  return false;
}

function primaDelBox(event, input, f) {
  const win = finestra(f);
  if (input.key === 'Escape') { event.preventDefault(); Box.chiudi(win, 'esc'); tocchi.chiuso(); return true; }
  if (input.control || input.meta || input.alt) return false;
  const l = D.daTasto(input.key, input.code);
  const v = l ? D.diLettera(cfg, l) : null;
  if (!v) return false;
  event.preventDefault();
  Box.chiudi(win, 'scelta');
  tocchi.chiuso();
  esegui(v.id, win);
  return true;
}

// Un clic o la rotellina fra i tocchi: Ctrl+clic e Ctrl+rotella non sono tocchi.
function mouse(wc, input) {
  if (!input || (input.type !== 'mouseDown' && input.type !== 'mouseWheel')) return;
  if (tocchi.evento({ tipo: 'mouse', t: Date.now() }, cfg) === 'annulla') fermaAttesa();
}

async function caricaUsate() {
  if (usate) return usate;
  try {
    const r = await require('./shim/storage').get(USATE);
    usate = r && r[USATE] && typeof r[USATE] === 'object' ? { ...r[USATE] } : {};
  } catch (_) { usate = {}; }
  return usate;
}
// L'ordine del box segue l'uso; in incognito non resta traccia.
function segnaUso(id, win) {
  if (win && win._filoIncognito) return;
  caricaUsate().then((u) => {
    u[id] = Date.now();
    return require('./shim/storage').set({ [USATE]: u });
  }).catch(() => {});
}

async function apriBox(win) {
  if (!win || win.isDestroyed()) { tocchi.chiuso(); return; }
  tocchi.aperto();
  const u = await caricaUsate();
  if (tocchi.fase() !== 'aperto' || win.isDestroyed()) return;
  const aperto = Box.apri(win, D.ordinate(cfg, u), {
    scegli: (id) => esegui(id, win),
    assegna: (id, l) => { cambiaLettera(win, id, l).catch(() => {}); },
    chiuso: () => tocchi.chiuso(),
  });
  if (!aperto) tocchi.chiuso();
}

// Dal box: la lettera nuova si salva come ogni impostazione toccata a mano, e il box si ridisegna aperto.
async function cambiaLettera(win, id, l) {
  const r = D.assegna(cfg, id, l);
  if (r.rifiuto) return;
  const { applySettingsUpdate } = require('./services/handlers');
  const scrivi = () => require('./services/registroCambi').con({ via: 'interfaccia', dove: 'doppio_ctrl' }, () => applySettingsUpdate({ doppioCtrl: { lettere: r.lettere } }));
  await (win && win._filoIncognito ? require('./shim/storage').runIncognito(scrivi) : scrivi());
  cfg = { ...cfg, lettere: D.normalizza({ lettere: r.lettere }).lettere };
  Box.aggiorna(win, D.ordinate(cfg, await caricaUsate()));
}

function avvisa(win, testo) {
  try { if (win && !win.isDestroyed()) win.webContents.send('shell:toast', { text: testo, opts: { durationSec: 6, key: 'doppio-ctrl' } }); } catch (_) {}
}

const attivaDi = (win) => {
  const tm = win && win._filoTabs;
  return tm ? tm.tabs.find((t) => t.id === tm.activeId) || null : null;
};
const HOME = /^filo:\/\/(newtab|dashboard)\//i;

// Le azioni: ognuna è la funzione del suo tasto o del suo menu.
const AZIONI = {
  cerca(win) {
    const t = attivaDi(win);
    // Nella home si apre la ricerca della colonna; da un'altra scheda la si porta alla home, con la ricerca aperta
    // (come il tasto Home della barra).
    if (t && HOME.test(t.url || '')) { try { t.view.webContents.send('shortcut:triggered', { command: 'cerca-nel-filo' }); } catch (_) {} return; }
    if (t) win._filoTabs.navigate(t.id, 'filo://newtab/?cerca');
    else win._filoTabs.openTab('filo://newtab/?cerca');
  },
  impostazioni(win) {
    // Il tasto Impostazioni della home: il menu Impostazioni, aperto sotto il punto dove stava il box.
    const cb = win.getContentBounds();
    try { win.webContents.send('shell:trigger-button', { command: 'settings', anchor: { x: Math.round(cb.width / 2 - 120), y: Math.round(cb.height / 4) } }); } catch (_) {}
  },
  cattura: (win) => sullaPagina(win, 'screenshot'),
  trascrivi: (win) => sullaPagina(win, 'transcribe'),
  tema() {
    const { nativeTheme } = require('electron');
    const prossimo = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
    const { applySettingsUpdate } = require('./services/handlers');
    return require('./services/registroCambi').con({ via: 'interfaccia', dove: 'doppio_ctrl' }, () => applySettingsUpdate({ theme: prossimo }));
  },
  schermoIntero(win) {
    const tabs = win._filoTabs;
    require('./services/azioniContate').azione('fullscreen', () => tabs.toggleContentFullscreen(), { incognito: !!win._filoIncognito });
  },
  aiuto: (win) => require('./shortcuts').dispatch('open-help-sidebar', win),
  salvaPerDopo: (win) => require('./shortcuts').dispatch('save-for-later', win),
  riapri(win) {
    require('./services/azioniContate').azione('reopen-closed-tab', () => win._filoTabs.riapriChiusa({ tasto: 'doppio_ctrl' }).catch(() => {}), { incognito: !!win._filoIncognito });
  },
  async muto(win) {
    const M = globalThis.SN_SISTEMA_MAIN;
    const st = M && typeof M.stato === 'function' ? M.stato() : null;
    const muto = !!(st && st.volume && st.volume.muto === true);
    const r = await require('./services/comandiSistema').comanda({ cosa: 'volume', muto: !muto });
    avvisa(win, r && r.ok ? (r.muto ? 'Computer muto' : 'Audio del computer riacceso') : (r && r.frase) || 'Il volume non è cambiato.');
  },
  async pausa(win) {
    const naviga = require('./services/azioni/naviga');
    const ctx = { sender: { win }, schedeViste: null };
    const suona = win._filoTabs.tabs.some((t) => t.audible || t._mediaInCorso);
    const r = suona ? await naviga.PAUSA_AUDIO({}, ctx) : await naviga.RIPRENDI_AUDIO({}, ctx);
    if (!r || !r.executed) avvisa(win, suona ? 'Niente da mettere in pausa.' : 'Niente da far ripartire.');
  },
  leggi(win) {
    const t = attivaDi(win);
    if (t) { try { t.view.webContents.send('shortcut:triggered', { command: 'leggi-ad-alta-voce' }); } catch (_) {} }
  },
  async blocca(win) {
    const B = require('./services/bloccaComputer');
    const r = await B.blocca();
    if (!r.ok) avvisa(win, B.frase(r.errore));
  },
  async cuffie(win) {
    const S = require('./services/comandiSistema');
    const preferiti = (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti || [];
    if (!preferiti.length) { avvisa(win, 'Nessuna cuffia preferita: sceglila nelle Preferenze, o chiedilo a Filo.'); return; }
    const el = await S.comanda({ cosa: 'bluetooth', elenca: true });
    if (!el || !el.ok) { avvisa(win, (el && el.frase) || 'Il Bluetooth non risponde.'); return; }
    // L'ultima segnata come preferita vince fra due accoppiate.
    const d = [...preferiti].reverse().map((a) => el.elenco.find((x) => x.indirizzo === a)).find(Boolean);
    if (!d) { avvisa(win, 'Le cuffie preferite non sono fra i dispositivi abbinati.'); return; }
    const r = await S.comanda({ cosa: 'bluetooth', dispositivo: d.nome, collega: !d.collegato });
    if (r && r.ok) avvisa(win, r.collegato ? `${d.nome}: collegate` : `${d.nome}: scollegate`);
    else avvisa(win, (r && r.frase) || 'Le cuffie non hanno risposto.');
  },
};

// Le azioni della pagina passano dalla barra laterale, come le sue icone (cattura, trascrivi).
function sullaPagina(win, icona) {
  const b = win._filoTabs && win._filoTabs.barra;
  if (b && typeof b.eseguiSullaPagina === 'function') b.eseguiSullaPagina(icona);
}

function esegui(id, win) {
  if (!win || win.isDestroyed() || !win._filoTabs) return;
  const v = D.voci(cfg).find((x) => x.id === id) || D.azione(id);
  if (!v) return;
  segnaUso(id, win);
  try {
    if (v.url) { win._filoTabs.openTab(v.url, { origine: { tipo: 'filo' } }); return; }
    const fn = AZIONI[id];
    if (fn) Promise.resolve(fn(win)).catch((e) => console.warn('[Filo] doppio Ctrl', id, e && e.message ? e.message : e));
  } catch (e) { console.warn('[Filo] doppio Ctrl', id, e && e.message ? e.message : e); }
}

module.exports = { configura, tasto, mouse, esegui, AZIONI, _perProve: { fase: () => tocchi.fase(), dimenticaUsate() { usate = null; } } };

// Guardare una finestra o lo schermo per la chat (#778): elenca, sceglie, cattura in memoria e fa leggere a un modello.
// Non clicca e non scrive, e l'immagine non tocca il disco: vive in questa chiamata. Il livello sta in actionLevels.js
// (VEDI_SCHERMO); prove in tests/unit/vediSchermo.test.mjs e tests/vedi-schermo.spec.mjs.
'use strict';

// Il lato lungo chiesto al sistema e quello che va al modello: un 4K resta leggibile, una PNG da decine di MB no.
const LATO_CATTURA = 2560;
const LATO_MODELLO = 2000;
const QUALITA = 85;
const SELETTORE = 'selettore';
const PANNELLO_MAC = 'mac-registrazione-schermo';
const MAX_CHIAVI = 64;

const FRASE_MAC = 'macOS fa vedere a Filo le finestre delle altre app solo col permesso «Registrazione schermo». '
  + 'Concedilo in Impostazioni di sistema → Privacy e sicurezza → Registrazione schermo, poi riapri Filo';

function normalizza(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[«»"“”]/g, ' ').replace(/\s+/g, ' ').trim();
}

function acceso(settings) {
  return !!(settings && settings.schermo && settings.schermo.guarda === true);
}

// Chromium su Linux cattura dal selettore del sistema (PipeWire) quando la sessione è Wayland, anche con Filo su X:
// lì non si elencano le finestre, e ogni cattura apre il selettore.
function sessioneWayland(env = process.env, piattaforma = process.platform) {
  if (piattaforma !== 'linux') return false;
  return String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland' && !!env.WAYLAND_DISPLAY;
}

function maniglia(id) {
  const m = /^window:(\d+):/.exec(String(id || ''));
  return m ? m[1] : '';
}

// Due finestre con lo stesso titolo restano distinguibili per nome: è il nome che il modello rimanda.
function nomiUnici(voci) {
  const visti = new Map();
  return voci.map((v) => {
    const base = String(v.nome || '').trim() || 'Finestra senza titolo';
    const k = normalizza(base);
    const n = (visti.get(k) || 0) + 1;
    visti.set(k, n);
    return { ...v, nome: n > 1 ? `${base} (${n})` : base };
  });
}

// Chromium li chiama «Entire screen» / «Screen 2»: qui si dice anche quale è il principale e dove sta Filo,
// perché «l'altro schermo» si capisca.
function nomiSchermi(schermi, { primario = '', conFilo = '' } = {}) {
  if (schermi.length === 1) return [{ ...schermi[0], nome: 'Schermo intero' }];
  return schermi.map((s, i) => {
    const note = [];
    if (s.displayId && String(s.displayId) === String(primario)) note.push('principale');
    if (s.displayId && String(s.displayId) === String(conFilo)) note.push('quello con Filo');
    return { ...s, nome: `Schermo ${i + 1}${note.length ? ` (${note.join(', ')})` : ''}` };
  });
}

// La finestra che il modello ha nominato: esatta, poi contenuta, poi con tutte le parole. Più d'una = si chiede all'utente.
function scegli(voci, richiesta) {
  const q = normalizza(richiesta);
  if (!q) return { manca: true };
  const prova = (filtro) => {
    const l = voci.filter(filtro);
    if (l.length === 1) return { voce: l[0] };
    if (l.length > 1) return { ambigue: l };
    return null;
  };
  const parole = q.split(' ').filter((p) => p.length > 1);
  return prova((v) => normalizza(v.nome) === q)
    || prova((v) => normalizza(v.nome).includes(q))
    || (parole.length ? prova((v) => { const n = normalizza(v.nome); return parole.every((p) => n.includes(p)); }) : null)
    || { nessuna: true };
}

function perElenco(voci) {
  return voci.map((v) => ({ nome: v.nome, tipo: v.tipo, filo: !!v.filo, ...(v.davanti ? { davanti: true } : {}) }));
}

// Un'immagine tutta nera è quello che macOS dà senza permesso: non va al modello come se fosse la finestra.
function tuttaNera(img) {
  let b = null;
  try { b = img.toBitmap(); } catch (_) { return false; }
  if (!b || b.length < 4) return false;
  const passo = Math.max(1, Math.floor(b.length / 4 / 4000)) * 4;
  for (let i = 0; i + 2 < b.length; i += passo) {
    if (b[i] > 8 || b[i + 1] > 8 || b[i + 2] > 8) return false;
  }
  return true;
}

function immagineDa(img) {
  if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
    return { errore: 'il sistema non mi ha dato l\'immagine: forse la finestra è ridotta a icona' };
  }
  const { width, height } = img.getSize();
  if (!width || !height) return { errore: 'il sistema non mi ha dato l\'immagine: forse la finestra è ridotta a icona' };
  if (tuttaNera(img)) return { errore: 'il sistema mi ha dato un\'immagine tutta nera', nera: true };
  const vista = Math.max(width, height) > LATO_MODELLO
    ? img.resize(width >= height ? { width: LATO_MODELLO, quality: 'best' } : { height: LATO_MODELLO, quality: 'best' })
    : img;
  return { dataUrl: `data:image/jpeg;base64,${vista.toJPEG(QUALITA).toString('base64')}` };
}

function sistemaVero() {
  const electron = require('electron');
  const { BrowserWindow } = electron;
  const finestre = () => BrowserWindow.getAllWindows().filter((w) => w && !w.isDestroyed());
  return {
    piattaforma: () => process.platform,
    wayland: () => sessioneWayland(),
    permessoMac: () => {
      try { return electron.systemPreferences.getMediaAccessStatus('screen'); } catch (_) { return 'unknown'; }
    },
    // La prima richiesta di cattura fa comparire la domanda di macOS e mette Filo nell'elenco del permesso.
    chiediPermessoMac: async () => {
      try { await electron.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch (_) {}
    },
    apriPannello: async (chiave) => {
      const uri = require('./comandiSistema').uriImpostazioni(chiave);
      if (uri) await electron.shell.openExternal(uri);
    },
    fonti: async ({ tipi = ['window', 'screen'], lato = 0 } = {}) => {
      const lista = await electron.desktopCapturer.getSources({
        types: tipi, thumbnailSize: { width: lato, height: lato }, fetchWindowIcons: false,
      });
      return lista.map((s) => ({
        id: String(s.id),
        nome: String(s.name || ''),
        tipo: String(s.id).startsWith('screen:') ? 'schermo' : 'finestra',
        displayId: String(s.display_id || ''),
        immagine: lato > 0 ? s.thumbnail : null,
      }));
    },
    // Le finestre di Filo si fotografano dalla loro scheda in vista: niente permessi del sistema, su ogni piattaforma.
    finestreFilo: () => finestre().filter((w) => w._filoTabs).map((w) => {
      const tm = w._filoTabs;
      const tab = (tm.tabs || []).find((t) => t.id === tm.activeId);
      return {
        id: `filo:${w.id}`, tipo: 'finestra', filo: true,
        nome: `Filo: ${String((tab && tab.title) || 'scheda vuota')}`,
        url: String((tab && tab.url) || ''),
        wc: tab && tab.view ? tab.view.webContents : null,
      };
    }),
    maniglieFilo: () => finestre().map((w) => {
      try { return maniglia(w.getMediaSourceId()); } catch (_) { return ''; }
    }).filter(Boolean),
    schermi: () => {
      const { screen } = electron;
      const primario = screen.getPrimaryDisplay();
      const tutti = screen.getAllDisplays();
      const w = BrowserWindow.getFocusedWindow() || finestre().find((x) => x._filoTabs);
      let conFilo = '';
      try { if (w) conFilo = String(screen.getDisplayMatching(w.getBounds()).id); } catch (_) {}
      const lato = Math.max(...tutti.map((d) => Math.max(d.size.width, d.size.height) * (d.scaleFactor || 1)), 0);
      return { primario: String(primario.id), conFilo, lato: Math.round(lato) };
    },
    delicata: async (url) => {
      if (!/^https?:/i.test(String(url || ''))) return '';
      try { return String((await globalThis.SN_DELICATE.filtro())(url) || ''); } catch (_) { return 'filtro_guasto'; }
    },
  };
}

function crea({ sistema = null } = {}) {
  let sis = sistema;
  const S = () => (sis || (sis = sistemaVero()));
  const approvate = new Map();
  const pannelli = new Set();

  function nuovoTurno(chiave) {
    approvate.delete(String(chiave));
    pannelli.delete(String(chiave));
  }
  function approva(chiave, id) {
    const k = String(chiave);
    let s = approvate.get(k);
    if (!s) {
      s = new Set();
      approvate.set(k, s);
      if (approvate.size > MAX_CHIAVI) approvate.delete(approvate.keys().next().value);
    }
    s.add(String(id));
  }
  function approvata(chiave, id) {
    const s = approvate.get(String(chiave));
    return !!(s && s.has(String(id)));
  }

  function latoCattura() {
    let lato = 0;
    try { lato = Number(S().schermi().lato) || 0; } catch (_) {}
    return Math.min(LATO_CATTURA, lato > 0 ? lato : LATO_CATTURA);
  }

  // Cosa si può guardare adesso. Su Wayland e su un Mac senza permesso le finestre delle altre app non si elencano:
  // al loro posto il selettore del sistema, o la nota sul permesso.
  async function elenca() {
    const s = S();
    const filo = s.finestreFilo();
    let esterne = [];
    let nota = '';
    let permesso = '';
    if (s.wayland()) {
      esterne = [{ id: SELETTORE, tipo: 'selettore', filo: false, nome: 'Una finestra o lo schermo, scelti da te nel selettore del sistema' }];
    } else if (s.piattaforma() === 'darwin' && s.permessoMac() !== 'granted') {
      permesso = s.permessoMac();
      nota = 'Le finestre delle altre app su questo Mac si vedono solo col permesso «Registrazione schermo».';
    } else {
      const proprie = new Set(s.maniglieFilo());
      const fonti = await s.fonti({ lato: 0 });
      const finestre = fonti.filter((f) => f.tipo === 'finestra' && f.nome.trim() && !proprie.has(maniglia(f.id)));
      let info = {};
      try { info = s.schermi(); } catch (_) {}
      const schermi = nomiSchermi(fonti.filter((f) => f.tipo === 'schermo'), info);
      // Il sistema le dà nell'ordine in cui sono sovrapposte: la prima è quella appena lasciata per scrivere a Filo,
      // cioè «questa finestra».
      esterne = [...finestre.map((f, i) => ({ id: f.id, tipo: 'finestra', filo: false, nome: f.nome, ...(i === 0 ? { davanti: true } : {}) })), ...schermi.map((f) => ({ id: f.id, tipo: 'schermo', filo: false, nome: f.nome }))];
    }
    return { voci: nomiUnici([...esterne, ...filo.map((f) => ({ id: f.id, tipo: 'finestra', filo: true, nome: f.nome, url: f.url }))]), nota, permesso };
  }

  async function esitoPermessoMac(chiave, stato, voci) {
    const s = S();
    // La domanda di macOS si fa una volta; dopo un no serve il pannello, aperto una volta per richiesta.
    if (stato === 'not-determined') await s.chiediPermessoMac();
    else if (!pannelli.has(String(chiave))) {
      pannelli.add(String(chiave));
      try { await s.apriPannello(PANNELLO_MAC); } catch (_) {}
    }
    return {
      executed: false, kept: true,
      output: { permesso: 'mac', stato: String(stato || ''), apri: PANNELLO_MAC, frase: FRASE_MAC, elenco: perElenco(voci) },
    };
  }

  // Prima del gate: niente se è spenta; altrimenti la finestra nominata, scelta dal main. `mostrata` è quella del
  // popup: all'OK vale lei, non ciò che lo stesso nome trova adesso (#592).
  async function prepara(action, { settings = null, chiave = '', mostrata = null } = {}) {
    delete action._finestra;
    delete action._approvata;
    if (!acceso(settings)) return { esito: { executed: false, kept: true, output: { spenta: true } } };
    const richiesta = String(action.finestra ?? action.nome ?? '').trim();
    const { voci, nota, permesso } = await elenca();
    let scelta;
    if (mostrata && mostrata.id) {
      const v = voci.find((x) => x.id === String(mostrata.id));
      if (!v) {
        return { esito: { executed: false, kept: false, output: { finestra: String(mostrata.nome || richiesta), errore: 'non è più aperta' } } };
      }
      scelta = { voce: v };
    } else {
      scelta = scegli(voci, richiesta);
    }
    // Su un Mac senza permesso anche l'elenco porta al permesso: è il primo passo del modello, e senza la domanda di
    // macOS Filo non compare nemmeno nel pannello.
    if (permesso && (scelta.manca || scelta.nessuna)) return { esito: await esitoPermessoMac(chiave, permesso, voci) };
    if (scelta.manca || scelta.ambigue) {
      return {
        esito: {
          executed: true, kept: false,
          output: {
            elenco: perElenco(voci), ...(scelta.ambigue ? { ambigue: perElenco(scelta.ambigue), richiesta } : {}),
            ...(nota ? { nota } : {}),
          },
        },
      };
    }
    if (scelta.nessuna) {
      return { esito: { executed: false, kept: false, output: { richiesta, nessuna: true, elenco: perElenco(voci), ...(nota ? { nota } : {}) } } };
    }
    const v = scelta.voce;
    const web = !!(v.filo && /^https?:/i.test(String(v.url || '')));
    const delicata = v.filo && web ? await S().delicata(v.url) : '';
    if (delicata) require('./contatoriSicurezza').misura('paginaDelicata', delicata, 'schermo');
    action._finestra = { id: v.id, nome: v.nome, tipo: v.tipo, filo: !!v.filo, web, ...(delicata ? { delicata } : {}) };
    action._approvata = approvata(chiave, v.id);
    return { voce: v };
  }

  async function cattura(f) {
    const s = S();
    if (f.filo) {
      const w = s.finestreFilo().find((x) => x.id === f.id);
      if (!w || !w.wc) return { errore: 'la finestra di Filo non è più aperta' };
      return immagineDa(await w.wc.capturePage());
    }
    if (f.tipo === SELETTORE) {
      const scelte = await s.fonti({ tipi: ['window', 'screen'], lato: latoCattura() });
      const sc = scelte.find((x) => x.immagine && !(typeof x.immagine.isEmpty === 'function' && x.immagine.isEmpty()));
      if (!sc) return { errore: 'nel selettore del sistema non è stato scelto niente' };
      return { ...immagineDa(sc.immagine), nome: sc.nome };
    }
    const fonti = await s.fonti({ tipi: [f.tipo === 'schermo' ? 'screen' : 'window'], lato: latoCattura() });
    const trovata = fonti.find((x) => x.id === f.id);
    if (!trovata) return { errore: 'non è più aperta' };
    return immagineDa(trovata.immagine);
  }

  // Dopo il gate: l'OK (o la finestra già guardata in questa richiesta) c'è. Torna solo testo.
  async function guarda(action, { chiave = '', domanda = '', leggi, fraseErrore = null } = {}) {
    const f = action._finestra;
    if (!f || !f.id) return { executed: false, kept: false, output: { errore: 'nessuna finestra scelta' } };
    if (!f.filo || f.delicata) approva(chiave, f.id);
    let img;
    try { img = await cattura(f); } catch (e) { img = { errore: `la cattura non è riuscita (${(e && e.message) || e})` }; }
    const nome = img.nome || f.nome;
    if (img.errore) {
      const s = S();
      if (img.nera && !f.filo && s.piattaforma() === 'darwin') {
        const r = await esitoPermessoMac(chiave, s.permessoMac(), []);
        return { ...r, output: { ...r.output, finestra: nome } };
      }
      return { executed: false, kept: false, output: { finestra: nome, tipo: f.tipo, filo: !!f.filo, errore: img.errore } };
    }
    const cosa = String(action.domanda || '').trim();
    let testo = '';
    try {
      testo = String(await leggi({ dataUrl: img.dataUrl, finestra: nome, domanda: String(domanda || '').trim(), cosa }) || '').trim();
    } catch (e) {
      const frase = (fraseErrore && fraseErrore(e)) || 'il modello che legge le immagini non ha risposto';
      return { executed: false, kept: false, output: { finestra: nome, tipo: f.tipo, filo: !!f.filo, errore: frase } };
    }
    if (!testo) return { executed: false, kept: false, output: { finestra: nome, tipo: f.tipo, filo: !!f.filo, errore: 'il modello che legge le immagini ha risposto vuoto' } };
    return { executed: true, kept: false, output: { finestra: nome, tipo: f.tipo, filo: !!f.filo, web: !!f.web, testo } };
  }

  const _perProve = {
    // Le prove sostituiscono i pezzi del sistema che il contenitore non ha (finestre di altre app, permessi del Mac).
    usaSistema(parziale) { sis = parziale && typeof parziale === 'object' ? { ...sistemaVero(), ...parziale } : null; },
  };

  return { elenca, prepara, guarda, nuovoTurno, approva, approvata, _perProve };
}

module.exports = {
  crea, acceso, scegli, normalizza, nomiUnici, nomiSchermi, sessioneWayland, maniglia, tuttaNera,
  LATO_CATTURA, LATO_MODELLO, SELETTORE, PANNELLO_MAC, FRASE_MAC,
};

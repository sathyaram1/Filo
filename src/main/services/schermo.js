// Guardare una finestra o lo schermo per la chat (#778): elenca, sceglie, cattura in memoria e fa leggere a un modello.
// Non clicca e non scrive, e l'immagine non tocca il disco: vive in questa chiamata. Il livello sta in actionLevels.js
// (VEDI_SCHERMO); prove in tests/unit/vediSchermo.test.mjs e tests/vedi-schermo.spec.mjs.
'use strict';

const Foto = require('./fotoDellaPagina');
const { interseca } = require('./campiNeiRiquadri');

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

function senzaImmagine(img) {
  if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
    return { errore: 'il sistema non mi ha dato l\'immagine: forse la finestra è ridotta a icona' };
  }
  const { width, height } = img.getSize();
  if (!width || !height) return { errore: 'il sistema non mi ha dato l\'immagine: forse la finestra è ridotta a icona' };
  if (tuttaNera(img)) return { errore: 'il sistema mi ha dato un\'immagine tutta nera', nera: true };
  return null;
}

function immagineDa(img) {
  const no = senzaImmagine(img);
  if (no) return no;
  const { width, height } = img.getSize();
  const vista = Math.max(width, height) > LATO_MODELLO
    ? img.resize(width >= height ? { width: LATO_MODELLO, quality: 'best' } : { height: LATO_MODELLO, quality: 'best' })
    : img;
  return { dataUrl: `data:image/jpeg;base64,${vista.toJPEG(QUALITA).toString('base64')}` };
}

// ─── Le finestre di Filo dentro la foto dello schermo (#2116.5) ──────────────────────────────────────────────────────
// Passano dalle stesse coperture della finestra guardata da sola; una che non si misura si copre per intero, così le
// altre app restano visibili. Contano anche le finestrelle di accesso, che sono di Filo ma non hanno schede.

// Corta: con il nome della finestra sta nel motivo della riga d'esito, che si taglia a 200 caratteri.
const FRASE_SELETTORE = 'mentre sceglievi nel selettore una finestra di Filo ha cambiato quello che mostra e poteva restare scoperta: riprova';
// Grigio dei veli: lo stesso delle coperture dipinte sulla foto.
const TINTA_VELO = `#${Foto.GRIGIO.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** Il rettangolo del desktop (coordinate dello schermo) che la foto di `displayId` ritrae: quel monitor, o l'insieme dei
 *  monitor quando il sistema ne fa una foto sola (X11), scelto dalle proporzioni della foto. Null se non si sa. PURA. */
function areaDelloSchermo(rettangoli, displayId, rapporto) {
  const r = (rettangoli || []).filter((x) => x && x.width > 0 && x.height > 0);
  if (!r.length) return null;
  const left = Math.min(...r.map((x) => x.left)), top = Math.min(...r.map((x) => x.top));
  const insieme = {
    left, top,
    width: Math.max(...r.map((x) => x.left + x.width)) - left,
    height: Math.max(...r.map((x) => x.top + x.height)) - top,
  };
  const quello = r.find((x) => String(x.id) === String(displayId));
  if (!quello || !(rapporto > 0)) return quello || insieme;
  const scarto = (a) => Math.abs(Math.log((a.width / a.height) / rapporto));
  return scarto(insieme) < scarto(quello) ? insieme : quello;
}

/** Le coperture delle finestre di Filo in una foto dello schermo `larghezza`×`altezza` che ritrae `area`: `prima` e `dopo`
 *  sono le finestre in vista ai due lati dello scatto (`{ wc, vista }`), `misure[i]` le coperture di `prima[i]`.
 *  `{ lista }` in pixel della foto, o `{ no }` quando non si sa dove la foto mette le finestre. Una finestra che non si
 *  misura, o arrivata durante lo scatto senza la misura di prima, si copre per intero. PURA. */
function copertureDelloSchermo({ prima, dopo, misure, area, larghezza, altezza }) {
  if (!prima.length && !dopo.length) return { lista: [] };
  if (!area) return { no: 'misura' };
  const kx = larghezza / area.width, ky = altezza / area.height;
  const sulla = (v) => !!(v && interseca(v, area));
  const nellaFoto = (v) => ({ left: (v.left - area.left) * kx, top: (v.top - area.top) * ky, width: v.width * kx, height: v.height * ky });
  const intera = (v) => ({ ...nellaFoto(v), colore: Foto.GRIGIO });
  const lista = [];
  for (const w of dopo) if (sulla(w.vista) && !prima.some((p) => p.wc === w.wc)) lista.push(intera(w.vista));
  for (let i = 0; i < prima.length; i++) {
    const posti = [prima[i].vista, ...dopo.filter((w) => w.wc === prima[i].wc).map((w) => w.vista)].filter(sulla);
    for (const v of posti) lista.push(...(misure[i].no ? [intera(v)] : Foto.copertureNellaFoto(misure[i], nellaFoto(v), 2)));
  }
  return { lista };
}

/** I veli da posare dentro una finestra di Filo, in punti della finestra: `dentro` è dove la pagina sta nella finestra,
 *  `misura` la sua da copertureIntorno. Una pagina che non si misura si vela intera. PURA. */
function veliDellaFinestra(misura, dentro) {
  const tutta = { left: dentro.x, top: dentro.y, width: dentro.width, height: dentro.height };
  if (!misura || misura.no) return [tutta];
  return Foto.copertureNellaFoto(misura, tutta, 2);
}

/** Vero se ogni copertura di `dopo` sta sotto un velo posato per `prima` sulla stessa pagina, alla stessa grandezza. PURA. */
function velataGia(prima, dopo) {
  if (!prima || prima.no) return true;
  if (!dopo || dopo.no) return false;
  if (!prima.vista || !dopo.vista || prima.vista.w !== dopo.vista.w || prima.vista.h !== dopo.vista.h) return false;
  const dentro = (r, v) => r.left >= v.left - 1 && r.top >= v.top - 1
    && r.left + r.width <= v.left + v.width + 1 && r.top + r.height <= v.top + v.height + 1;
  return (dopo.lista || []).every((r) => (prima.lista || []).some((v) => dentro(r, v)));
}

const stessoPosto = (a, b) => !!(a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

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
    // `vista`: dove la scheda si disegna sul desktop, se la finestra si vede.
    finestreFilo: () => finestre().filter((w) => w._filoTabs).map((w) => {
      const tm = w._filoTabs;
      const tab = (tm.tabs || []).find((t) => t.id === tm.activeId);
      let vista = null;
      try {
        if (tab && tab.view && w.isVisible() && !w.isMinimized()) {
          const c = w.getContentBounds();
          const b = tab.view.getBounds();
          if (b.width > 0 && b.height > 0) vista = { left: c.x + b.x, top: c.y + b.y, width: b.width, height: b.height };
        }
      } catch (_) { vista = null; }
      return {
        id: `filo:${w.id}`, tipo: 'finestra', filo: true,
        nome: `Filo: ${String((tab && tab.title) || 'scheda vuota')}`,
        url: String((tab && tab.url) || ''),
        wc: tab && tab.view ? tab.view.webContents : null,
        vista,
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
      const rettangoli = tutti.map((d) => ({ id: String(d.id), left: d.bounds.x, top: d.bounds.y, width: d.bounds.width, height: d.bounds.height }));
      return { primario: String(primario.id), conFilo, lato: Math.round(lato), rettangoli };
    },
    delicata: async (url) => {
      if (!/^https?:/i.test(String(url || ''))) return '';
      try { return String((await globalThis.SN_DELICATE.filtro(null, { tipo: 'immagine' }))(url) || ''); } catch (_) { return 'filtro_guasto'; }
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
      // La scheda passa dalla stessa copertura dell'Aiuto (#810.17); se non si può coprire, al modello non parte.
      const r = await Foto.fotoPerModello(w.wc);
      if (!r.ok && r.code !== 'vuota') return { errore: `la foto non è partita: ${Foto.perche(r.code)}` };
      return immagineDa(r.ok ? r.img : null);
    }
    if (f.tipo === SELETTORE || f.tipo === 'schermo') return catturaConFilo(f);
    const fonti = await s.fonti({ tipi: ['window'], lato: latoCattura() });
    const trovata = fonti.find((x) => x.id === f.id);
    if (!trovata) return { errore: 'non è più aperta' };
    return immagineDa(trovata.immagine);
  }

  // Lo schermo, o quello che si sceglie nel selettore: dentro possono esserci finestre di Filo (#2116.5). Le finestre
  // delle altre app no, perché le finestre di Filo non stanno nel loro elenco.
  async function catturaConFilo(f) {
    const s = S();
    const selettore = f.tipo === SELETTORE;
    const inVista = () => s.finestreFilo().filter((w) => w.wc && w.vista);
    const prima = inVista();
    const wcs = prima.map((w) => w.wc);
    // Nel selettore non si sa dove finiscono le finestre di Filo: se una ha qualcosa da coprire non lo si apre nemmeno.
    if (selettore && prima.length && (await Foto.copertureIntorno(wcs, async () => true)).pagine.some(Foto.daCoprire)) {
      return { errore: FRASE_SELETTORE };
    }
    let sc = null;
    const { img, pagine } = await Foto.copertureIntorno(wcs, async () => {
      const fonti = await s.fonti({ tipi: selettore ? ['window', 'screen'] : ['screen'], lato: latoCattura() });
      sc = selettore
        ? fonti.find((x) => x.immagine && !(typeof x.immagine.isEmpty === 'function' && x.immagine.isEmpty()))
        : fonti.find((x) => x.id === f.id);
      return sc ? sc.immagine : null;
    });
    if (!sc) return { errore: selettore ? 'nel selettore del sistema non è stato scelto niente' : 'non è più aperta' };
    const nome = selettore ? { nome: sc.nome } : {};
    const no = senzaImmagine(img);
    if (no) return { ...no, ...nome };
    const dopo = inVista();
    if (selettore) {
      const nuova = dopo.some((w) => !prima.some((p) => p.wc === w.wc));
      if (nuova || pagine.some(Foto.daCoprire)) return { errore: FRASE_SELETTORE, ...nome };
      return { ...immagineDa(img), ...nome };
    }
    const { width, height } = img.getSize();
    let info = {};
    try { info = s.schermi() || {}; } catch (_) {}
    const c = copertureDelloSchermo({
      prima, dopo, misure: pagine, area: areaDelloSchermo(info.rettangoli, sc.displayId, width / height), larghezza: width, altezza: height,
    });
    if (c.no) return { errore: `la foto dello schermo non è partita: in una finestra di Filo ${Foto.perche(c.no)}` };
    if (!c.lista.length) return immagineDa(img);
    const coperta = Foto.dipintaSu(img, c.lista, { x: 1, y: 1 });
    if (!coperta) return { errore: `la foto dello schermo non è partita: in una finestra di Filo ${Foto.perche('misura')}` };
    return immagineDa(coperta);
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
  areaDelloSchermo, copertureDelloSchermo,
  LATO_CATTURA, LATO_MODELLO, SELETTORE, PANNELLO_MAC, FRASE_MAC, FRASE_SELETTORE,
};

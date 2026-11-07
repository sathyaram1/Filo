'use strict';
// I giudici fermi (#906): legge lo stato che il server scrive in config/automation.giudiciFermi e lo dice all'owner una
// volta per episodio nella barra della finestra, più una carta nella home che resta finché il server non lo azzera.
// Non decide niente sui feedback. Le regole: tests/unit/giudiciFermi.test.mjs.

const TIPO_CARTA = 'giudici-fermi';
const CHIAVE_BARRA = 'giudici-fermi';
const DETTO_KEY = 'giudiciFermiDetto';
const OGNI_MS = 5 * 60 * 1000;
const FOCUS_MIN_MS = 60 * 1000;
const CAUSE = new Set(['credit', 'auth']);

/** Lo stato letto dal server, o null se non c'è o è storto. */
function normalizza(raw) {
  if (!raw || typeof raw !== 'object' || !CAUSE.has(raw.causa)) return null;
  const da = typeof raw.da === 'string' ? raw.da.slice(0, 40) : '';
  if (!da || !Number.isFinite(Date.parse(da))) return null;
  const n = Number(raw.inAttesa);
  return {
    causa: raw.causa,
    da,
    ultimoErrore: typeof raw.ultimoErrore === 'string' ? raw.ultimoErrore.slice(0, 40) : da,
    inAttesa: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
  };
}

function quando(iso) {
  const d = new Date(iso);
  const due = (x) => String(x).padStart(2, '0');
  return `${due(d.getDate())}/${due(d.getMonth() + 1)} alle ${due(d.getHours())}:${due(d.getMinutes())}`;
}

/** Titolo, testo della carta, testo della barra e la pagina del tasto, per la causa. */
function testi(stato) {
  const credito = stato.causa === 'credit';
  const attesa = stato.inAttesa === 1 ? 'una segnalazione aspetta' : `${stato.inAttesa || 'le'} segnalazioni aspettano`;
  const fai = credito
    ? 'Ricarica il credito della chiave dei giudici, poi in Gestione premi «Ri-valuta i non filtrati».'
    : 'Reimposta la chiave in Automazioni, fra i Modelli di supporto, poi in Gestione premi «Ri-valuta i non filtrati».';
  const titolo = credito ? 'I giudici sono senza credito' : 'La chiave dei giudici viene rifiutata';
  return {
    titolo,
    // La cosa da fare per prima: la carta della home taglia le righe in fondo.
    testo: `${fai} Dal ${quando(stato.da)}, ${attesa} il giudizio e le routine non ricevono lavoro nuovo.`,
    barra: `${titolo}: le segnalazioni nuove non vengono giudicate. ${fai}`,
    apri: credito ? 'filo://manage/manage.html#rivaluta' : 'filo://manage/manage.html#automation',
    etichetta: credito ? 'Apri Ri-valuta' : 'Apri Automazioni',
  };
}

/**
 * Cosa fare dopo una lettura. PURA.
 * `letto`: { risposto, stato } (stato già normalizzato); `detto`: il «da» dell'ultimo episodio già detto nella barra;
 * `carte`: le notifiche di questo tipo, anche quelle tolte. → { barra, ritiraBarra, aggiungi, riscrivi: [{id,testo}], togli: [id] }
 */
function piano({ owner, letto, detto, carte }) {
  const tutte = Array.isArray(carte) ? carte : [];
  const vive = tutte.filter((c) => !c.dismissed);
  const out = { barra: null, ritiraBarra: false, aggiungi: null, riscrivi: [], togli: [] };
  // Chi non è (più) l'owner non tiene le sue carte; una lettura non riuscita non cambia niente.
  if (!owner) { out.togli = vive.map((c) => c.id); return out; }
  if (!letto || !letto.risposto) return out;
  const stato = letto.stato;
  if (!stato) {
    out.togli = vive.map((c) => c.id);
    out.ritiraBarra = vive.length > 0 || !!detto;
    return out;
  }
  const t = testi(stato);
  if (stato.da !== detto) out.barra = { testo: t.barra, apri: t.apri, etichetta: t.etichetta, da: stato.da };
  // Una carta per episodio e per causa: un episodio nuovo o una causa cambiata ne fanno una nuova.
  // Tolta dall'owner (la chat della home può togliere qualunque carta) resta tolta per quell'episodio.
  const giusta = tutte.find((c) => c.action && c.action.da === stato.da && c.action.causa === stato.causa);
  for (const c of vive) if (c !== giusta) out.togli.push(c.id);
  const action = { tipo: TIPO_CARTA, causa: stato.causa, da: stato.da, titolo: t.titolo, apri: t.apri, etichetta: t.etichetta };
  if (giusta && giusta.dismissed) return out;
  if (!giusta) out.aggiungi = { kind: 'alert', text: t.testo, action };
  else if (giusta.text !== t.testo) out.riscrivi.push({ id: giusta.id, testo: t.testo });
  return out;
}

/**
 * Il giro: all'avvio, al rientro nella finestra (non più di una volta al minuto) e ogni cinque minuti, solo per l'owner.
 * `deps`: isAdmin, leggi() → { risposto, raw }, mem (SN_FILO_MEMORY), storage (SN_STORAGE), avvisa, ritira, broadcast.
 */
function start(deps) {
  const { isAdmin, leggi, now = () => Date.now() } = deps;
  let ultima = 0;
  let inVolo = null;
  let ancora = false;

  async function giro() {
    const mem = deps.mem();
    if (!mem || !mem.listNotifications) return 'senza_memoria';
    const owner = !!isAdmin();
    let letto = null;
    if (owner) {
      ultima = now();
      try {
        const r = await leggi();
        letto = { risposto: !!(r && r.risposto), stato: normalizza(r && r.raw) };
      } catch (_) { letto = { risposto: false, stato: null }; }
    }
    let detto = '';
    try { detto = String((await deps.storage().getRaw(DETTO_KEY, '')) || ''); } catch (_) {}
    const carte = ((await mem.listNotifications({ includeDismissed: true })) || []).filter((n) => n && n.action && n.action.tipo === TIPO_CARTA);
    const p = piano({ owner, letto, detto, carte });
    let cambiato = false;
    for (const id of p.togli) { await mem.dismissNotification(id); cambiato = true; }
    if (p.aggiungi) { await mem.addNotification(p.aggiungi); cambiato = true; }
    for (const r of p.riscrivi) { if (await mem.setNotificationText(r.id, r.testo)) cambiato = true; }
    if (p.ritiraBarra) {
      deps.ritira(CHIAVE_BARRA);
      try { await deps.storage().setRaw(DETTO_KEY, ''); } catch (_) {}
    }
    if (p.barra) {
      const da = p.barra.da;
      // Si segna detto solo quando una cornice l'ha mostrato: un avvio senza finestra non brucia l'episodio.
      deps.avvisa(p.barra.testo, {
        chiave: CHIAVE_BARRA, tipo: 'giudici_fermi', azioni: [{ label: p.barra.etichetta, apriFilo: p.barra.apri }],
        detto: () => { Promise.resolve(deps.storage().setRaw(DETTO_KEY, da)).catch(() => {}); },
      });
    }
    if (cambiato) deps.broadcast();
    return p;
  }

  function colpo(perche) {
    if (perche === 'focus' && ultima && now() - ultima < FOCUS_MIN_MS) return Promise.resolve('presto');
    if (inVolo) { ancora = true; return inVolo; }
    inVolo = giro().catch((e) => { console.warn('[giudici] stato non letto', String((e && e.message) || e)); return 'errore'; })
      .then((esito) => {
        inVolo = null;
        if (ancora) { ancora = false; return colpo('coda'); }
        return esito;
      });
    return inVolo;
  }

  if (deps.timers !== false) {
    setTimeout(() => { colpo('avvio'); }, 8000).unref?.();
    setInterval(() => { colpo('orologio'); }, OGNI_MS).unref?.();
    try {
      const { app } = require('electron');
      app.on('browser-window-focus', (_e, win) => { if (win && win._filoTabs) colpo('focus'); });
    } catch (_) { /* fuori da Electron resta l'orologio */ }
  }
  return { colpo };
}

module.exports = { normalizza, testi, piano, start, TIPO_CARTA, CHIAVE_BARRA, DETTO_KEY, OGNI_MS };

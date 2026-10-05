// L'interfaccia ComputerDriver: quattro operazioni uguali per ogni driver e le regole che nessun driver salta.
// Non sa niente di Electron né del driver concreto: il valore di un campo password non esce mai da qui.
// Regole: tests/unit/computerDriver.test.mjs.

const CAMPO_PASSWORD = 'campo password';
const MOTIVO_DI_SERIE = 'Il componente per usare le altre applicazioni non è disponibile.';
// Un testo da scrivere più lungo si rifiuta col numero: chi lo manda sceglie cosa tenere.
const TETTO_TESTO = 100000;

const PULSANTI = ['sinistro', 'destro', 'centrale'];
const DIREZIONI = ['su', 'giu', 'sinistra', 'destra'];
const MODIFICATORI = ['ctrl', 'alt', 'shift', 'meta'];

function nonDisponibile(motivo) {
  return { ok: false, disponibile: false, motivo: String(motivo || MOTIVO_DI_SERIE) };
}
function rifiuto(motivo, extra = {}) {
  return { ok: false, disponibile: true, motivo, ...extra };
}

const testo = (v) => (v == null ? '' : String(v));
const bool = (v) => (typeof v === 'boolean' ? v : null);
const intero = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.trunc(Number(v)) : null);

function rettangolo(r) {
  if (!r || typeof r !== 'object') return null;
  const x = Number(r.x), y = Number(r.y);
  const w = Number(r.w ?? r.width), h = Number(r.h ?? r.height);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

const RE_RUOLO_PASSWORD = /password|secure/i;
const RE_MASCHERA = /^[•●∗*·⦁◦•●∙·⦁]+$/;
const RE_RUOLO_SCRIVIBILE = /edit|text|entry|field|combo|input/i;
const RE_PAROLE_PASSWORD = /pass ?word|passwort|contrase[ñn]a|mot de passe|senha|wachtwoord|has[łl]o|parola d.?ordine|passcode|passphrase|\bpin\b|codice segreto|codice di sblocco/i;

// Nel dubbio è un campo password: nascondere un valore in più costa poco, lasciarne uscire uno no.
// Windows (UIA IsPassword) e i driver che lo dicono arrivano col segno esplicito; macOS col campo di testo sicuro
// (AXSecureTextField, come ruolo o sottoruolo); Linux col ruolo «password text». Il valore mascherato e il nome
// coprono chi il segno non lo manda.
function eCampoPassword(n) {
  if (!n || typeof n !== 'object') return false;
  if (n.password === true) return true;
  if (RE_RUOLO_PASSWORD.test(testo(n.ruolo)) || RE_RUOLO_PASSWORD.test(testo(n.sottoruolo))) return true;
  const valore = testo(n.valore);
  if (valore && RE_MASCHERA.test(valore)) return true;
  return RE_RUOLO_SCRIVIBILE.test(testo(n.ruolo)) && RE_PAROLE_PASSWORD.test(testo(n.nome));
}

// Solo i campi elencati escono: un campo nuovo del driver (una descrizione del valore, un testo grezzo) resta dentro.
function normalizzaNodo(n, i) {
  const password = eCampoPassword(n);
  const valoreGrezzo = testo(n.valore);
  let nome = testo(n.nome);
  if (password && valoreGrezzo && nome.includes(valoreGrezzo)) nome = CAMPO_PASSWORD;
  return {
    id: n.id == null || n.id === '' ? null : String(n.id),
    ruolo: testo(n.ruolo),
    nome,
    valore: password ? CAMPO_PASSWORD : (n.valore == null ? null : valoreGrezzo),
    stato: { abilitato: bool(n.abilitato), selezionato: bool(n.selezionato) },
    posizione: rettangolo(n.posizione),
    isPassword: password,
    profondita: intero(n.profondita) ?? 0,
    genitore: intero(n.genitore),
    indice: intero(n.indice) ?? i,
  };
}

function normalizzaFinestra(f) {
  return {
    id: testo(f.id),
    app: testo(f.app),
    titolo: testo(f.titolo),
    posizione: rettangolo(f.posizione),
    visibile: bool(f.visibile),
    ridotta: bool(f.ridotta),
  };
}

function idFinestra(f) {
  if (f && typeof f === 'object') return testo(f.id).trim();
  return testo(f).trim();
}

function punto(p) {
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.x), y = Number(p.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// Il bersaglio di un gesto: una finestra, e dentro un elemento dell'albero o un punto.
function leggiBersaglio(b) {
  if (!b || typeof b !== 'object') return { errore: 'Manca il bersaglio del gesto: una finestra e un suo elemento o un punto.' };
  const finestra = idFinestra(b.finestra);
  if (!finestra) return { errore: 'Il bersaglio non dice in quale finestra agire.' };
  const nodo = b.nodo == null ? '' : testo(b.nodo && typeof b.nodo === 'object' ? b.nodo.id : b.nodo).trim();
  const p = punto(b);
  return { finestra, nodo: nodo || null, punto: p };
}

function leggiGesto(g, bersaglio) {
  if (!g || typeof g !== 'object') return { errore: 'Manca il gesto da fare.' };
  const tipo = testo(g.tipo).trim().toLowerCase();
  const serveUnPunto = () => (bersaglio.nodo || bersaglio.punto ? null : 'Il gesto vuole un elemento o un punto della finestra.');
  switch (tipo) {
    case 'clic': {
      const pulsante = g.pulsante == null ? 'sinistro' : testo(g.pulsante).toLowerCase();
      if (!PULSANTI.includes(pulsante)) return { errore: `Il pulsante «${testo(g.pulsante)}» non esiste: sinistro, destro o centrale.` };
      const volte = g.volte == null ? 1 : intero(g.volte);
      if (!(volte >= 1 && volte <= 3)) return { errore: 'Un clic si ripete da 1 a 3 volte.' };
      const manca = serveUnPunto();
      return manca ? { errore: manca } : { gesto: { tipo, pulsante, volte } };
    }
    case 'scrivi': {
      if (typeof g.testo !== 'string' || !g.testo.length) return { errore: 'Non c\'è niente da scrivere.' };
      if (g.testo.length > TETTO_TESTO) return { errore: `Il testo da scrivere è di ${g.testo.length} caratteri: il massimo per un gesto è ${TETTO_TESTO}.` };
      return { gesto: { tipo, testo: g.testo } };
    }
    case 'scorri': {
      const direzione = testo(g.direzione).toLowerCase().replace('ù', 'u');
      if (!DIREZIONI.includes(direzione)) return { errore: 'Si scorre su, giù, a sinistra o a destra.' };
      const quantita = g.quantita == null ? 3 : intero(g.quantita);
      if (!(quantita >= 1 && quantita <= 50)) return { errore: 'Si scorre da 1 a 50 passi alla volta.' };
      const manca = serveUnPunto();
      return manca ? { errore: manca } : { gesto: { tipo, direzione, quantita } };
    }
    case 'tasto': {
      const tasto = testo(g.tasto).trim();
      if (!tasto) return { errore: 'Manca il tasto da premere.' };
      const mods = Array.isArray(g.modificatori) ? g.modificatori.map((m) => testo(m).trim().toLowerCase()) : [];
      const ignoto = mods.find((m) => !MODIFICATORI.includes(m));
      if (ignoto) return { errore: `Il modificatore «${ignoto}» non esiste: ctrl, alt, shift o meta.` };
      return { gesto: { tipo, tasto, modificatori: [...new Set(mods)] } };
    }
    case 'trascina': {
      const a = punto(g.a);
      if (!a) return { errore: 'Un trascinamento vuole il punto d\'arrivo.' };
      const manca = serveUnPunto();
      return manca ? { errore: manca } : { gesto: { tipo, a } };
    }
    default:
      return { errore: `Il gesto «${testo(g.tipo)}» non esiste: clic, scrivi, scorri, tasto o trascina.` };
  }
}

// `apri()` dà l'implementazione del driver pronta, o il motivo per cui non c'è: dove sta il driver lo sa chi la passa.
function creaComputerDriver({ apri } = {}) {
  async function conDriver(fn) {
    let aperto;
    try { aperto = typeof apri === 'function' ? await apri() : null; } catch (e) { return nonDisponibile(e && e.message); }
    const impl = aperto && aperto.implementazione;
    if (!impl) return nonDisponibile(aperto && aperto.motivo);
    try {
      return await fn(impl);
    } catch (e) {
      return rifiuto(testo(e && e.message) || 'Il componente non ha risposto.');
    }
  }

  return {
    windows: () => conDriver(async (impl) => {
      const elenco = await impl.finestre();
      return { ok: true, finestre: (Array.isArray(elenco) ? elenco : []).filter((f) => f && idFinestra(f)).map(normalizzaFinestra) };
    }),

    tree: (finestra) => {
      const id = idFinestra(finestra);
      if (!id) return Promise.resolve(rifiuto('Manca la finestra di cui leggere l\'albero.'));
      return conDriver(async (impl) => {
        const r = (await impl.albero(id)) || {};
        return {
          ok: true,
          finestra: normalizzaFinestra({ ...(r.finestra || {}), id }),
          nodi: (Array.isArray(r.nodi) ? r.nodi : []).filter((n) => n && typeof n === 'object').map(normalizzaNodo),
          troncato: r.troncato === true,
        };
      });
    },

    shot: (finestra) => {
      const id = finestra == null ? null : idFinestra(finestra) || null;
      return conDriver(async (impl) => {
        const img = await impl.foto(id);
        if (!img || !img.base64) return rifiuto('Il componente non ha restituito un\'immagine.');
        return {
          ok: true,
          immagine: { mime: testo(img.mime) || 'image/png', base64: testo(img.base64), larghezza: intero(img.larghezza), altezza: intero(img.altezza) },
        };
      });
    },

    // Un gesto che sullo sfondo non si può fare torna così a chi l'ha chiesto: passare al primo piano lo decide lui.
    act: (target, gesto) => {
      const b = leggiBersaglio(target);
      if (b.errore) return Promise.resolve(rifiuto(b.errore));
      const g = leggiGesto(gesto, b);
      if (g.errore) return Promise.resolve(rifiuto(g.errore));
      return conDriver(async (impl) => {
        const r = (await impl.agisci(b, g.gesto)) || {};
        if (r.ok === false) {
          return rifiuto(testo(r.motivo) || 'Il gesto non è andato a segno.', {
            codice: testo(r.codice) || 'rifiutato',
            ...(r.primoPiano ? { suggerisce: 'primo-piano' } : {}),
          });
        }
        return { ok: true, effetto: testo(r.effetto) || 'sconosciuto', via: testo(r.via) || null };
      });
    },
  };
}

module.exports = {
  creaComputerDriver,
  eCampoPassword,
  normalizzaNodo,
  CAMPO_PASSWORD,
  TETTO_TESTO,
  MOTIVO_DI_SERIE,
};

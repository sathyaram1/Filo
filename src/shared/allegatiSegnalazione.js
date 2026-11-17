// Gli allegati di una segnalazione mandata dalla chat (#1668): cosa ha indicato il modello, cosa c'è nella
// conversazione, cosa parte. PURA: il modello indica e basta, i byte li prende il main dalla conversazione.
// Limiti e tipi sono quelli del riquadro «Invia feedback» (src/shared/feedbackAttachTypes.js); oltre, si rifiuta col numero.

(function (global) {
  'use strict';

  const LIMITI_DI_RISERVA = Object.freeze({ immagini: 5, file: 5, byte: 4 * 1024 * 1024 });
  const limiti = () => (global.SN_FEEDBACK_ATTACH && global.SN_FEEDBACK_ATTACH.LIMITI) || LIMITI_DI_RISERVA;

  const lista = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

  // Quello che il modello ha indicato, ripulito: numeri interi positivi, percorsi non vuoti, niente doppioni.
  function richiesti(action) {
    const a = action && typeof action === 'object' ? action : {};
    const immagini = [];
    for (const v of lista(a.immagini)) {
      const n = Number(String(v).trim().replace(/^#/, ''));
      if (Number.isInteger(n) && n > 0 && !immagini.includes(n)) immagini.push(n);
    }
    const file = [];
    for (const v of lista(a.file)) {
      const p = String(v == null ? '' : v).trim();
      if (p && !file.includes(p)) file.push(p);
    }
    return { immagini, file, schermata: a.schermata === true || a.schermata === 'true' };
  }

  function haAllegati(action) {
    const r = richiesti(action);
    return r.immagini.length > 0 || r.file.length > 0 || r.schermata;
  }

  // Le immagini e i file che l'utente ha mandato nella conversazione, nell'ordine. Le immagini si contano tutte
  // (anche quelle che il main non ha più in memoria), così il numero resta quello che vede il modello.
  // `fotoDi(m)`: i data URL ancora in memoria di quel messaggio, o null.
  function inventario(messaggi, fotoDi) {
    const immagini = [];
    const file = [];
    let n = 0;
    for (const m of Array.isArray(messaggi) ? messaggi : []) {
      if (!m || m.role !== 'user' || m.daModello) continue;
      const quante = Math.max(0, Math.floor(Number(m.images) || 0));
      const urls = quante && typeof fotoDi === 'function' ? (fotoDi(m) || []) : [];
      for (let i = 0; i < quante; i++) {
        n += 1;
        const u = urls[i];
        if (typeof u === 'string' && /^data:image\//i.test(u)) immagini.push({ numero: n, dataUrl: u });
      }
      for (const riga of String(m.text == null ? '' : m.text).split('\n')) {
        const r = /^File: (.+)$/.exec(riga.trim());
        const p = r ? r[1].trim() : '';
        if (p && !file.includes(p)) file.push(p);
      }
    }
    return { immagini, file };
  }

  // Le voci da allegare: solo quelle che esistono nella conversazione. Le altre finiscono in `scartati`, mai inventate.
  // `schermata`: { dataUrl, nome } dell'ultima finestra guardata in questa chat, o null.
  function scegli(action, inv, schermata) {
    const r = richiesti(action);
    const voci = [];
    const scartati = [];
    for (const n of r.immagini) {
      const im = (inv && Array.isArray(inv.immagini) ? inv.immagini : []).find((x) => x.numero === n);
      if (im) voci.push({ id: `immagine:${n}`, tipo: 'immagine', nome: `immagine ${n}.${estensione(im.dataUrl)}`, dataUrl: im.dataUrl });
      else scartati.push(`immagine ${n}`);
    }
    for (const p of r.file) {
      if (inv && Array.isArray(inv.file) && inv.file.includes(p)) voci.push({ id: `file:${p}`, tipo: 'file', percorso: p, nome: nomeDi(p) });
      else scartati.push(nomeDi(p));
    }
    if (r.schermata) {
      if (schermata && typeof schermata.dataUrl === 'string' && /^data:image\//i.test(schermata.dataUrl)) {
        voci.push({ id: 'schermata', tipo: 'immagine', nome: `schermata${schermata.nome ? ` ${schermata.nome}` : ''}.${estensione(schermata.dataUrl)}`, dataUrl: schermata.dataUrl });
      } else scartati.push('schermata');
    }
    return { voci, scartati };
  }

  // Gli id che il riquadro di conferma rimanda indietro tornano nei campi dell'azione: il main li ricerca da capo.
  function soloQuesti(action, ids) {
    const tieni = new Set(lista(ids).map(String));
    const r = richiesti(action);
    return {
      ...action,
      immagini: r.immagini.filter((n) => tieni.has(`immagine:${n}`)),
      file: r.file.filter((p) => tieni.has(`file:${p}`)),
      schermata: r.schermata && tieni.has('schermata'),
    };
  }

  function nomeDi(percorso) {
    const s = String(percorso || '').replace(/[\\/]+$/, '');
    return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1) || s;
  }

  function estensione(dataUrl) {
    const m = /^data:image\/([a-z0-9.+-]+)/i.exec(String(dataUrl || ''));
    const t = m ? m[1].toLowerCase() : 'png';
    return t === 'jpeg' ? 'jpg' : t;
  }

  function byteDi(dataUrl) {
    const FB = global.SN_FEEDBACK;
    if (FB && typeof FB.byteDiDataUrl === 'function') return FB.byteDiDataUrl(dataUrl);
    const s = String(dataUrl || '');
    const corpo = s.slice(s.indexOf(',') + 1);
    const pad = corpo.endsWith('==') ? 2 : (corpo.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor((corpo.length * 3) / 4) - pad);
  }

  // Per eccesso: un file appena sopra il tetto non deve leggersi uguale al tetto.
  function mb(byte) {
    return `${(Math.ceil((byte / (1024 * 1024)) * 10) / 10).toFixed(1).replace('.', ',')} MB`;
  }

  // Il problema di una voce pronta ({ tipo, nome, dataUrl, byte?, problema? }) che le impedisce di partire, o ''.
  function problemaDi(v) {
    if (!v) return 'mancante';
    if (v.problema) return String(v.problema);
    if (!v.dataUrl) return 'non si legge';
    const L = limiti();
    const byte = Number.isFinite(v.byte) ? v.byte : byteDi(v.dataUrl);
    if (byte > L.byte) return `troppo grande: ${mb(byte)}, al massimo ${mb(L.byte)}`;
    return '';
  }

  // Le voci oltre i tetti del riquadro «Invia feedback»: la frase col numero, '' se ci stanno. Chi manda sceglie cosa togliere.
  function oltreIlimiti(voci) {
    const L = limiti();
    const buone = (Array.isArray(voci) ? voci : []).filter((v) => !problemaDi(v));
    const im = buone.filter((v) => v.tipo === 'immagine').length;
    const fi = buone.filter((v) => v.tipo === 'file').length;
    const frasi = [];
    if (im > L.immagini) frasi.push(`${im} immagini, ne partono al massimo ${L.immagini}: togline ${im - L.immagini}`);
    if (fi > L.file) frasi.push(`${fi} file, ne partono al massimo ${L.file}: togline ${fi - L.file}`);
    return frasi.join('; ');
  }

  // Il payload di SN_FEEDBACK.submit con gli allegati. Mai un taglio: una voce che non può partire o un tetto superato
  // tornano come `errore`, e la segnalazione non parte.
  function payload(base, voci) {
    const tutte = Array.isArray(voci) ? voci : [];
    const rotta = tutte.find((v) => problemaDi(v));
    if (rotta) return { errore: `l'allegato «${rotta.nome}» non può partire (${problemaDi(rotta)})` };
    const oltre = oltreIlimiti(tutte);
    if (oltre) return { errore: `troppi allegati: ${oltre}` };
    const images = tutte.filter((v) => v.tipo === 'immagine').map((v) => ({ name: v.nome, dataUrl: v.dataUrl }));
    const files = tutte.filter((v) => v.tipo === 'file').map((v) => ({ name: v.nome, type: v.type || '', dataUrl: v.dataUrl }));
    return { payload: { ...base, ...(images.length ? { images } : {}), ...(files.length ? { files } : {}) } };
  }

  // Quello che il riquadro di conferma mostra: niente byte dei file, l'anteprima solo delle immagini.
  function anteprime(voci) {
    return (Array.isArray(voci) ? voci : []).map((v) => ({
      id: v.id, tipo: v.tipo, nome: v.nome,
      ...(v.tipo === 'immagine' && v.dataUrl ? { anteprima: v.dataUrl } : {}),
      ...(problemaDi(v) ? { problema: problemaDi(v) } : {}),
    }));
  }

  global.SN_ALLEGATI_SEGNALAZIONE = {
    richiesti, haAllegati, inventario, scegli, soloQuesti, problemaDi, oltreIlimiti, payload, anteprime, nomeDi, limiti,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

// La home come coda del filo (#869): quali righe vede l'utente, in che ordine, a pezzi, e la ricerca nel filo. Logica
// pura sui dati che il main legge dal filo e dal registro dei cambi; il disegno sta in src/pages/dashboard/dashboard-coda.js.
// Regole: patterns/la-home-e-la-coda-del-filo.md, sentinella tests/unit/filoCoda.test.mjs.

(function (global) {
  'use strict';

  const ORA_MS = 60 * 60 * 1000;
  // Una conversazione della home continua finché non passa un'ora di silenzio, come quelle delle altre app.
  const PAUSA_MS = ORA_MS;
  const PEZZO = 60;
  // Una raffica di cose successe (un timer, poi una mail) è un messaggio solo; oltre, Filo scrive un messaggio nuovo.
  const FUSIONE_MS = 30 * 60 * 1000;
  // Il saluto della giornata non arriva prima di quest'ora: a notte fonda l'apertura di una scheda non è un inizio.
  const ORA_GIORNATA = 5;
  // Le azioni chieste in chat hanno il loro segno sulla bolla: nel filo una riga loro la meritano le altre.
  const VIE_COL_SEGNO = new Set(['chat', 'assistente']);

  const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };
  const giornoDi = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const eApp = (c) => !!(c && c.app && global.SN_FILO_APP && global.SN_FILO_APP.eApp(c.app));

  function haContenuto(m) {
    if (!m || typeof m !== 'object') return false;
    return !!(String(m.text == null ? '' : m.text).trim() || (Array.isArray(m.actions) && m.actions.length)
      || Number(m.images) > 0 || (Array.isArray(m.guardate) && m.guardate.length));
  }

  // `trovaChat(id)`: la chat del filo con quell'id, per la risposta citata da un messaggio (#1620).
  function voceMessaggio(c, m, i, qui, trovaChat = null) {
    const v = {
      k: 'msg', key: `m:${c.id}:${i}`, chat: c.id, i, ts: m.ts, role: m.role === 'user' ? 'user' : 'filo',
      text: String(m.text == null ? '' : m.text),
    };
    const R = global.SN_RISPOSTA_A;
    const citata = m.rispostaA && R ? R.risolvi(m.rispostaA, trovaChat) : null;
    if (citata) v.rispostaA = citata;
    if (Array.isArray(m.actions) && m.actions.length) v.actions = m.actions.slice();
    if (Array.isArray(m.cambi) && m.cambi.length) v.cambi = m.cambi.slice();
    if (Number(m.images) > 0) v.images = Number(m.images);
    if (Array.isArray(m.fotoInMemoria) && m.fotoInMemoria.length) v.fotoInMemoria = m.fotoInMemoria.slice();
    if (Array.isArray(m.guardate) && m.guardate.length) v.guardate = m.guardate.slice();
    if (m.spontaneo) v.spontaneo = true;
    // I verdetti dei collegamenti di una frase di Filo (#868.6, #1505): la home li ritrova anche dopo un riavvio.
    if (Array.isArray(m.linkDaConfermare) && m.linkDaConfermare.length) v.linkDaConfermare = m.linkDaConfermare.slice();
    if (m.senzaVerdetto === true) v.senzaVerdetto = true;
    if (c.onboarding) v.onboarding = true;
    const disp = Array.isArray(c.dispositivi) ? c.dispositivi[i] : '';
    if (qui && disp && disp !== qui) v.altrove = true;
    return v;
  }

  // Tutto ciò che la home sa mostrare, dal più vecchio: messaggi, conversazioni delle altre app (una riga ciascuna),
  // cambi fatti fuori dalla chat, e le pagine visitate ripiegate in gruppi fra un evento e l'altro, mai a cavallo di
  // due giorni.
  function elementi({ chats = [], pagine = [], cambi = [], qui = '' } = {}) {
    const altri = [];
    let n = 0;
    for (const c of Array.isArray(chats) ? chats : []) {
      if (!c || !Array.isArray(c.messages) || !c.messages.length) continue;
      if (eApp(c)) {
        const vista = global.SN_FILO_APP.vista(c);
        altri.push({ k: 'app', key: `a:${c.id}`, chat: c.id, ts: vista.inizio, vista, _n: n++ });
        continue;
      }
      // Una riga tardiva (l'esito arrivato a conversazione lasciata, #1295) sta subito dopo la sua chat, non sotto la
      // conversazione dopo; `fine` è l'arrivo, così chi chiede le novità la riceve lo stesso.
      let prima = NaN;
      c.messages.forEach((m, i) => {
        const t = ms(m.ts);
        if (!Number.isFinite(t)) return;
        const posto = m.tardiva && Number.isFinite(prima) && prima < t ? prima + 1 : t;
        prima = posto;
        if (!haContenuto(m)) return;
        const v = voceMessaggio(c, m, i, qui);
        if (posto !== t) { v.ts = new Date(posto).toISOString(); v.fine = m.ts; }
        altri.push({ ...v, _n: n++ });
      });
    }
    for (const e of Array.isArray(cambi) ? cambi : []) {
      if (!e || !e.id || VIE_COL_SEGNO.has(e.via) || !Number.isFinite(ms(e.ts))) continue;
      // Un cambio ritoccato dopo (cambi.js, fondi) resta all'ora del primo ritocco: `fine` lo fa tornare a chi allinea.
      const fine = Number.isFinite(ms(e.agg)) && ms(e.agg) > ms(e.ts) ? { fine: e.agg } : {};
      altri.push({
        k: 'cambio', key: `c:${e.id}`, id: e.id, ts: e.ts, ...fine, tipo: e.tipo || '', frase: e.frase || '', provenienza: e.provenienza || '',
        annullabile: !!e.annullabile, annullatoDa: e.annullatoDa || null, annulla: e.annulla || null, _n: n++,
      });
    }
    altri.sort((a, b) => (ms(a.ts) - ms(b.ts)) || (a._n - b._n));
    const visite = (Array.isArray(pagine) ? pagine : []).filter((p) => p && p.id && Number.isFinite(ms(p.ts)))
      .sort((a, b) => ms(a.ts) - ms(b.ts));

    const out = [];
    let gruppo = null;
    const chiudi = () => { if (gruppo) { out.push(gruppo); gruppo = null; } };
    let j = 0;
    for (const a of altri) {
      const t = ms(a.ts);
      while (j < visite.length && ms(visite[j].ts) <= t) aggiungiPagina(visite[j++]);
      chiudi();
      delete a._n;
      out.push(a);
    }
    while (j < visite.length) aggiungiPagina(visite[j++]);
    chiudi();
    return out;

    function aggiungiPagina(p) {
      const t = ms(p.ts);
      if (gruppo && giornoDi(ms(gruppo.ts)) !== giornoDi(t)) chiudi();
      const pagina = {
        id: p.id, ts: p.ts, url: String(p.url || ''), titolo: String(p.titolo || ''),
        ...(p.archivio ? { archivio: p.archivio } : {}), ...(p.urlTagliato ? { urlTagliato: true } : {}),
      };
      if (qui && p.dispositivo && p.dispositivo !== qui) pagina.altrove = true;
      if (!gruppo) gruppo = { k: 'pagine', key: `p:${p.id}`, ts: p.ts, fine: p.ts, pagine: [] };
      gruppo.pagine.push(pagina);
      gruppo.fine = p.ts;
    }
  }

  // La pagina che dà il nome al gruppo: l'ultima con un titolo vero, che è quella dove l'utente si è fermato.
  function nomeDelGruppo(g) {
    const pagine = g && Array.isArray(g.pagine) ? g.pagine : [];
    for (let i = pagine.length - 1; i >= 0; i--) {
      const t = String(pagine[i].titolo || '').trim();
      if (t && t !== pagine[i].url) return t;
    }
    const ultima = pagine[pagine.length - 1];
    return ultima ? sito(ultima.url) : '';
  }

  function sito(url) {
    try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch (_) { return String(url || ''); }
  }

  // Cosa apre una pagina del filo: solo una pagina web, e un indirizzo tagliato alla misura (#1525) non come intero
  // (porterebbe altrove), ma il suo sito. Null se non c'è niente da aprire.
  function daAprire(p) {
    const url = String((p && p.url) || '');
    if (!/^https?:\/\//i.test(url)) return null;
    if (!p.urlTagliato) return { url, sito: false };
    try { return { url: new URL(url).origin + '/', sito: true }; } catch (_) { return null; }
  }

  // Un pezzo della coda: gli ultimi `quanti` prima di `prima` (esclusa), o da poco prima di `fino` in poi, o tutto ciò
  // che è arrivato dopo `dopo`. Due elementi con la stessa ora non finiscono in due pezzi diversi.
  function pezzo(lista, { prima = null, fino = null, dopo = null, quanti = PEZZO } = {}) {
    const el = Array.isArray(lista) ? lista : [];
    if (dopo != null) {
      const t = ms(dopo);
      return { elementi: el.filter((e) => ms(e.ts) > t || (e.fine && ms(e.fine) > t)), inizio: false };
    }
    let fine = el.length;
    if (prima != null) {
      const t = ms(prima);
      fine = el.findIndex((e) => ms(e.ts) >= t);
      if (fine < 0) fine = el.length;
    }
    let inizio = Math.max(0, fine - Math.max(1, Number(quanti) || PEZZO));
    if (fino != null) {
      const t = ms(fino);
      const i = el.findIndex((e) => ms(e.fine || e.ts) >= t);
      if (i >= 0 && i < inizio) inizio = Math.max(0, i - 3);
    }
    while (inizio > 0 && ms(el[inizio - 1].ts) === ms(el[inizio].ts)) inizio--;
    return { elementi: el.slice(inizio, fine), inizio: inizio === 0 };
  }

  // La conversazione della home che una scheda nuova continua: l'ultima, se non è passata un'ora di silenzio o se
  // l'ultima parola è di Filo che ha scritto da sé. L'accoglienza ha una fine sua e non si continua, né una chiusa apposta.
  function chatCorrente(chats, { ora = Date.now() } = {}) {
    let ultima = null;
    for (const c of Array.isArray(chats) ? chats : []) {
      if (!c || eApp(c) || c.onboarding || !Array.isArray(c.messages) || !c.messages.length) continue;
      if (!ultima || (ms(c.updatedAt) || 0) > (ms(ultima.updatedAt) || 0)) ultima = c;
    }
    if (!ultima || ultima.finita) return null;
    const m = ultima.messages[ultima.messages.length - 1];
    const t = ms(ultima.updatedAt);
    // Una parola spontanea di Filo si continua (e si fonde) solo nello stesso giorno: quella di ieri resta sotto «ieri»
    // e il saluto di oggi non riracconta il timer di ieri sera.
    if (m && m.spontaneo) return Number.isFinite(ms(m.ts)) && giornoDi(ms(m.ts)) === giornoDi(ora) ? ultima : null;
    return Number.isFinite(t) && ora - t <= PAUSA_MS ? ultima : null;
  }

  // Due messaggi di Filo scritti di sua iniziativa si fondono solo se sono vicini nel tempo, nello stesso giorno, e nel
  // filo non è successo niente fra l'uno e l'altro: il fuso prende il posto e l'ora del primo, sopra ciò che è venuto dopo.
  function siFonde({ chats = [], pagine = [], cambi = [] } = {}, chat, { ora = Date.now() } = {}) {
    const lista = Array.isArray(chats) ? chats : [];
    const c = lista.find((x) => x && x.id === chat);
    const m = c && Array.isArray(c.messages) ? c.messages[c.messages.length - 1] : null;
    if (!m || !m.spontaneo || m.role !== 'filo') return false;
    const t = ms(m.ts);
    if (!Number.isFinite(t) || ora - t > FUSIONE_MS || giornoDi(t) !== giornoDi(ora)) return false;
    const dopo = (iso) => ms(iso) > t;
    for (const x of lista) {
      if (!x || x.id === chat || !Array.isArray(x.messages)) continue;
      if (x.messages.some((y) => haContenuto(y) && dopo(y.ts))) return false;
    }
    if ((Array.isArray(pagine) ? pagine : []).some((p) => p && dopo(p.ts))) return false;
    return !(Array.isArray(cambi) ? cambi : []).some((e) => e && !VIE_COL_SEGNO.has(e.via) && (dopo(e.ts) || dopo(e.agg)));
  }

  // La giornata comincia alla prima apertura dopo le cinque, se nella home non si è ancora detto niente oggi.
  function serveGiornata(chats, { ora = Date.now() } = {}) {
    if (new Date(ora).getHours() < ORA_GIORNATA) return false;
    const oggi = giornoDi(ora);
    for (const c of Array.isArray(chats) ? chats : []) {
      if (!c || eApp(c) || !Array.isArray(c.messages)) continue;
      if (c.messages.some((m) => Number.isFinite(ms(m && m.ts)) && giornoDi(ms(m.ts)) === oggi)) return false;
    }
    return true;
  }

  // Minuscole e senza accenti: «perché» si trova scrivendo «perche», «Orche» scrivendo «orche».
  function norma(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function termini(q) {
    return [...new Set(norma(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))];
  }
  // Nei passi allargati una parola corta vale dall'inizio di una parola: «iva» non trova «arrivano» (#1295).
  const inizi = new Map();
  function dove(n, w, aInizio) {
    if (!aInizio || w.length > 3) return n.indexOf(w);
    let re = inizi.get(w);
    if (!re) { re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'); inizi.set(w, re); }
    const m = re.exec(n);
    return m ? m.index + m[0].length - w.length : -1;
  }
  const contiene = (testo, ts, aInizio) => { const n = norma(testo); return ts.every((w) => dove(n, w, aInizio) >= 0); };

  function estratto(testo, ts, largo = 70, aInizio = false) {
    const t = String(testo || '').replace(/\s+/g, ' ').trim();
    const n = norma(t);
    let at = -1;
    for (const w of ts) { const i = dove(n, w, aInizio); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0 || t.length <= largo * 2) return t.length > largo * 2 ? `${t.slice(0, largo * 2)}…` : t;
    const da = Math.max(0, at - largo);
    const a = Math.min(t.length, at + largo);
    return `${da > 0 ? '…' : ''}${t.slice(da, a)}${a < t.length ? '…' : ''}`;
  }

  // Cerca nel filo senza passare dal modello: parole nei messaggi (anche delle altre app), nei titoli e negli indirizzi
  // delle pagine visitate, e nel contenuto delle schede chiuse (riassunto ed estratto che il loro archivio tiene).
  // Tutte le parole devono esserci; dal più recente.
  function cerca({ chats = [], pagine = [], schede = [] } = {}, q, { max = 40, largo = false } = {}) {
    const ts = termini(q);
    if (!ts.length) return { messaggi: [], pagine: [], termini: [] };
    const messaggi = [];
    for (const c of Array.isArray(chats) ? chats : []) {
      if (!c || !Array.isArray(c.messages)) continue;
      c.messages.forEach((m, i) => {
        const testo = String((m && m.text) || '');
        if (!testo.trim() || !contiene(testo, ts, largo)) return;
        messaggi.push({
          k: 'msg', chat: c.id, i, ts: m.ts, role: m.role === 'user' ? 'user' : 'filo', testo: estratto(testo, ts, 70, largo),
          ...(eApp(c) ? { app: c.app } : {}),
        });
      });
    }
    messaggi.sort((a, b) => (ms(b.ts) || 0) - (ms(a.ts) || 0));
    const perUrl = new Map();
    for (const p of Array.isArray(pagine) ? pagine : []) {
      if (!p || !p.url || !contiene(`${p.titolo || ''} ${p.url}`, ts, largo)) continue;
      const prima = perUrl.get(p.url);
      if (!prima || ms(p.ts) > ms(prima.ts)) {
        perUrl.set(p.url, {
          k: 'pagina', id: p.id, url: p.url, titolo: String(p.titolo || ''), ts: p.ts,
          ...(p.archivio ? { archivio: p.archivio } : {}), ...(p.urlTagliato ? { urlTagliato: true } : {}),
        });
      }
    }
    for (const s of Array.isArray(schede) ? schede : []) {
      if (!s || !s.url) continue;
      const dentro = `${s.summary || ''} ${s.snippet || ''}`;
      if (!contiene(`${s.title || ''} ${s.url} ${dentro}`, ts, largo)) continue;
      const ts0 = s.closedAt || s.openedAt || '';
      const prima = perUrl.get(s.url);
      const nelContenuto = !contiene(`${s.title || ''} ${s.url}`, ts, largo);
      const voce = {
        k: 'pagina', url: s.url, titolo: String(s.title || ''), ts: prima && ms(prima.ts) > ms(ts0) ? prima.ts : ts0,
        ...(prima && prima.id ? { id: prima.id } : {}),
        // La scheda chiusa si riapre com'era (scroll, paese): la voce d'archivio la conosce il main (#872).
        ...(s.id ? { archivio: s.id } : {}),
        ...(s.urlTagliato || (prima && prima.urlTagliato) ? { urlTagliato: true } : {}),
        ...(nelContenuto ? { estratto: estratto(dentro, ts, 70, largo) } : {}),
      };
      if (!prima || nelContenuto) perUrl.set(s.url, voce);
      // Trovata per titolo fra le visite: si riapre lo stesso dalla voce d'archivio più recente.
      else if (s.id && (!prima.archivio || ms(ts0) > ms(prima.chiusa))) Object.assign(prima, { archivio: s.id, chiusa: ts0 });
    }
    const trovate = [...perUrl.values()].sort((a, b) => (ms(b.ts) || 0) - (ms(a.ts) || 0));
    return { messaggi: messaggi.slice(0, max), pagine: trovate.slice(0, max), termini: ts, tanti: messaggi.length + trovate.length };
  }

  global.SN_FILO_CODA = {
    PAUSA_MS, PEZZO, ORA_GIORNATA, FUSIONE_MS, elementi, nomeDelGruppo, sito, daAprire, pezzo, chatCorrente, siFonde, serveGiornata,
    termini, cerca,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

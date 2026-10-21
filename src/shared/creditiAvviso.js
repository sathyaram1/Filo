// L'avviso prima che i crediti finiscano (#818): diario dei consumi, proiezione, soglie, rimedi e frasi. Logica pura.
// Quando si valuta, a chi si consegna e come si applica un rimedio li decide handlers/avvisoCrediti.js.
// Regole: tests/unit/creditiAvviso.test.mjs.

(function (global) {
  'use strict';

  const C0 = global.SN_CONST || {};
  const PREDEFINITI = Object.freeze({ attivo: true, giorni: 2, percento: 10, ...((C0.DEFAULT_SETTINGS && C0.DEFAULT_SETTINGS.avvisoCrediti) || {}) });
  // Il diario serve al ritmo (tre giorni) e ai consumi per funzione (sette): due settimane bastano con margine.
  const GIORNI_DIARIO = 14;
  const GIORNI_RITMO = 3;
  const GIORNI_PER_FUNZIONE = 7;
  const GIORNO_MS = 24 * 60 * 60 * 1000;
  // Una chiamata della spiegazione partita da sola alla selezione: nel diario sta accanto a quella chiesta.
  const ANTICIPATA = 'anticipata';

  const A = () => (global.SN_CONST && global.SN_CONST.ACTIONS) || {};

  function chiaveGiorno(d = new Date()) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  function giorniFra(da, a) {
    const x = Date.parse(`${da}T12:00:00Z`);
    const y = Date.parse(`${a}T12:00:00Z`);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
    return Math.round((y - x) / GIORNO_MS);
  }

  function spostaGiorno(chiave, n) {
    const t = Date.parse(`${chiave}T12:00:00Z`) + n * GIORNO_MS;
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // Le soglie che si cambiano dalle Preferenze e dalla chat. 0 spegne quella condizione.
  const L0 = C0.AVVISO_CREDITI_LIMITI || { giorni: [0, 30], percento: [0, 100] };
  const LIMITI = Object.freeze({
    giorni: Object.freeze({ min: L0.giorni[0], max: L0.giorni[1] }),
    percento: Object.freeze({ min: L0.percento[0], max: L0.percento[1] }),
  });
  // Vuoto o non numerico = il predefinito; fuori scala torna dentro (la chat invece rifiuta col numero).
  function numeroSoglia(k, v) {
    const l = LIMITI[k];
    if (!l) return null;
    if (v === '' || v == null) return PREDEFINITI[k];
    const n = Number(String(v).trim().replace(',', '.'));
    if (!Number.isFinite(n)) return PREDEFINITI[k];
    return Math.min(l.max, Math.max(l.min, n));
  }

  function soglieDa(s) {
    const x = s && typeof s === 'object' ? s : {};
    const giorni = Number(x.giorni);
    const percento = Number(x.percento);
    return {
      attivo: x.attivo !== false,
      giorni: Number.isFinite(giorni) && giorni >= 0 ? giorni : PREDEFINITI.giorni,
      percento: Number.isFinite(percento) && percento >= 0 ? percento : PREDEFINITI.percento,
    };
  }

  // La chiave di una riga del diario: l'azione, con `#anticipata` se è partita da sola.
  function chiaveAzione(azione, tag) {
    const a = String(azione || '');
    return tag ? `${a}#${tag}` : a;
  }
  function azioneDi(chiave) { return String(chiave || '').split('#')[0]; }

  // Diario: { 'YYYY-MM-DD': { [chiave]: { c: crediti, p: token in ingresso, o: token in uscita, n: chiamate } } }.
  // Torna un diario nuovo; i giorni oltre la finestra cadono.
  function aggiungi(diario, { giorno = chiaveGiorno(), azione, tag = '', crediti = 0, prompt = 0, completion = 0 } = {}) {
    const d = {};
    for (const [g, v] of Object.entries(diario && typeof diario === 'object' ? diario : {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(g) && v && typeof v === 'object' && giorniFra(g, giorno) < GIORNI_DIARIO) d[g] = { ...v };
    }
    const k = chiaveAzione(azione, tag);
    if (!k) return d;
    const oggi = d[giorno] || {};
    const r = { c: 0, p: 0, o: 0, n: 0, ...(oggi[k] || {}) };
    r.c += Math.max(0, num(crediti));
    r.p += Math.max(0, Math.floor(num(prompt)));
    r.o += Math.max(0, Math.floor(num(completion)));
    r.n += 1;
    d[giorno] = { ...oggi, [k]: r };
    return d;
  }

  // Una spiegazione preparata alla selezione che poi l'utente ha aperto: spegnerla non avrebbe risparmiato niente.
  function aggiungiUso(diario, { giorno = chiaveGiorno(), azione, tag = ANTICIPATA } = {}) {
    const d = aggiungi(diario, { giorno });
    const k = chiaveAzione(azione, tag);
    if (!k) return d;
    const oggi = d[giorno] || {};
    const r = { c: 0, p: 0, o: 0, n: 0, u: 0, ...(oggi[k] || {}) };
    r.u = (Number(r.u) || 0) + 1;
    d[giorno] = { ...oggi, [k]: r };
    return d;
  }

  function totaleDelGiorno(g) {
    let t = 0;
    for (const v of Object.values(g || {})) t += Math.max(0, num(v && v.c));
    return t;
  }

  function primoGiorno(diario) {
    const giorni = Object.keys(diario || {}).filter((g) => /^\d{4}-\d{2}-\d{2}$/.test(g)).sort();
    return giorni[0] || null;
  }

  // Il ritmo al giorno: la media dei giorni interi dal primo registrato (al più tre), oppure quanto si è già speso oggi
  // se è di più. Il primo giorno vale solo quello di oggi: dividerlo per le ore passate gonfierebbe ogni mattina.
  function ritmo(diario, { oggi = chiaveGiorno() } = {}) {
    const d = diario || {};
    const diOggi = totaleDelGiorno(d[oggi]);
    const primo = primoGiorno(d);
    let somma = 0;
    let giorni = 0;
    if (primo) {
      for (let i = 1; i <= GIORNI_RITMO; i++) {
        const g = spostaGiorno(oggi, -i);
        if (g < primo) break;
        somma += totaleDelGiorno(d[g]);
        giorni++;
      }
    }
    const media = giorni ? somma / giorni : 0;
    return { perGiorno: Math.max(media, diOggi), media, oggi: diOggi, giorniMedia: giorni };
  }

  // Quanto dura il saldo: il consumo netto è il ritmo meno la quota che arriva ogni giorno.
  function proiezione({ saldo, perGiorno, quota }) {
    const s = num(saldo);
    const netto = num(perGiorno) - Math.max(0, num(quota));
    if (s <= 0) return { netto, giorni: 0 };
    if (netto <= 0) return { netto, giorni: Infinity };
    return { netto, giorni: s / netto };
  }

  // Scatta l'avviso? `sogliaSaldo` è il saldo sotto cui una delle due condizioni vale col ritmo di adesso.
  function valuta({ saldo, perGiorno, quota, ingresso, soglie } = {}) {
    const sg = soglieDa(soglie);
    const s = num(saldo);
    const { netto, giorni } = proiezione({ saldo: s, perGiorno, quota });
    const motivi = [];
    if (sg.giorni > 0 && giorni <= sg.giorni) motivi.push('proiezione');
    const ing = Math.max(0, num(ingresso));
    const sottoPercento = ing > 0 && sg.percento > 0 ? ing * (sg.percento / 100) : 0;
    if (sottoPercento > 0 && s < sottoPercento) motivi.push('percento');
    const sogliaSaldo = Math.max(sottoPercento, netto > 0 ? sg.giorni * netto : 0);
    return { scatta: sg.attivo && motivi.length > 0, motivi, giorni, netto, sogliaSaldo };
  }

  // Dopo un avviso si riarma solo quando il saldo risale sopra la soglia di allora. La quota del giorno da sola non
  // basta: chi vive della quota se lo ritroverebbe ogni mattina, cioè a calendario.
  function sogliaRiarmo({ sogliaSaldo, quota }) {
    return Math.max(0, num(sogliaSaldo)) + Math.max(0, num(quota));
  }
  function riarmato(stato, saldo) {
    if (!stato || stato.armato !== false) return true;
    return num(saldo) > num(stato.sogliaRiarmo);
  }

  // ── Frasi ───────────────────────────────────────────────────────────────────
  const GIORNI_SETTIMANA = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

  function fmt(n) {
    const W = global.SN_WALLET;
    if (W && W.formatCredits) return W.formatCredits(n);
    return String(Math.round((Number(n) || 0) * 10) / 10).replace('.', ',');
  }
  function fmtInt(n) {
    return new Intl.NumberFormat('it-IT', { useGrouping: true }).format(Math.max(0, Math.round(Number(n) || 0)));
  }

  // Il giorno in cui il saldo arriva a zero, detto come lo direbbe una persona.
  function quando(giorni, adesso = new Date()) {
    if (!Number.isFinite(giorni)) return null;
    const ora = adesso instanceof Date ? adesso : new Date(adesso);
    const fine = new Date(ora.getTime() + Math.max(0, giorni) * GIORNO_MS);
    const diff = giorniFra(chiaveGiorno(ora), chiaveGiorno(fine));
    if (diff <= 0) return 'oggi';
    if (diff === 1) return 'domani';
    if (diff === 2) return 'dopodomani';
    if (diff < 7) return GIORNI_SETTIMANA[fine.getDay()];
    return `fra ${diff} giorni`;
  }

  function frase({ saldo, giorni, motivi = [], percento = PREDEFINITI.percento, adesso = new Date() } = {}) {
    const s = num(saldo);
    if (s <= 0) return 'I crediti di Filo sono finiti.';
    const q = quando(giorni, adesso);
    const resto = `Ti restano ${fmt(s)} crediti`;
    if (q) return `${resto}: al ritmo di oggi finiscono ${q}.`;
    if (motivi.includes('percento')) {
      return `${resto}, meno del ${fmtInt(percento)}% di quelli che avevi all'inizio. Al ritmo di oggi la quota di ogni giorno basta.`;
    }
    return `${resto}.`;
  }

  // La prossima quota: un giorno dopo l'ultima arrivata. { quando: 'stanotte verso le 2:00' | …, at } o null.
  function prossimaQuota(grants, adesso = new Date()) {
    const ora = adesso instanceof Date ? adesso : new Date(adesso);
    const ultime = (Array.isArray(grants) ? grants : [])
      .filter((g) => g && /^daily(?::|$)/.test(String(g.why || '')) && Number.isFinite(Date.parse(String(g.at || ''))))
      .map((g) => Date.parse(String(g.at)));
    if (!ultime.length) return null;
    let t = Math.max(...ultime) + GIORNO_MS;
    while (t <= ora.getTime()) t += GIORNO_MS;
    const d = new Date(t);
    const hhmm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const diff = giorniFra(chiaveGiorno(ora), chiaveGiorno(d));
    let parola;
    if (diff <= 0) parola = d.getHours() >= 18 ? `stasera verso le ${hhmm}` : `oggi verso le ${hhmm}`;
    else if (diff === 1 && d.getHours() < 6) parola = `stanotte verso le ${hhmm}`;
    else parola = `domani verso le ${hhmm}`;
    return { quando: parola, at: d.toISOString() };
  }

  // ── Rimedi ──────────────────────────────────────────────────────────────────
  // Le funzioni che lavorano da sole e si possono spegnere. `percorso` è l'impostazione; le azioni sono quelle del
  // diario. Le difese (siti pericolosi, cookie) restano fuori: non si risparmia sulla sicurezza.
  function automatiche() {
    const a = A();
    return [
      { id: 'spiegaAnticipata', percorso: 'spiegaAnticipata.enabled', chiavi: [chiaveAzione(a.EXPLAIN || 'explain', ANTICIPATA)], nome: 'la spiegazione preparata quando selezioni un testo' },
      { id: 'riassuntoSchede', percorso: 'riassuntoSchede.enabled', chiavi: [a.FILO_TAB_SUMMARY || 'filo_tab_summary'], nome: 'il riassunto delle schede che chiudi' },
      { id: 'riordinoSchede', percorso: 'autoArchive.enabled', chiavi: [a.FILO_TAB_TRIAGE || 'filo_tab_triage'], nome: 'il riordino automatico delle schede' },
      // Il correttore (#1446): spenta la parte del modello, gli errori restano quelli che Filo trova da sé.
      { id: 'correttore', percorso: 'correttore.modelloErrori', chiavi: [a.SPELLCHECK_SEMANTIC || 'spellcheck_semantic', 'spellcheck_word'], nome: 'il controllo degli errori col modello, nel correttore' },
      { id: 'suggerimenti', percorso: 'featureFlags.spellcheckContext', chiavi: [a.SPELLCHECK_CONTEXT || 'spellcheck_context'], nome: 'i suggerimenti del correttore' },
      { id: 'categorie', percorso: 'featureFlags.categorize', chiavi: [a.CATEGORIZE || 'categorize'], nome: 'la categoria delle pagine' },
      { id: 'nomiFile', percorso: 'nomiSensati.scaricamenti', chiavi: [a.FILE_NAME || 'file_name'], nome: 'il nome sensato dei file scaricati' },
    ];
  }

  function leggiPercorso(obj, percorso) {
    let x = obj;
    for (const p of String(percorso).split('.')) {
      if (!x || typeof x !== 'object') return undefined;
      x = x[p];
    }
    return x;
  }
  // { a: { b: v } } per 'a.b': il pezzo da mandare al salvataggio, che fonde in profondità.
  function pezzoPer(percorso, valore) {
    const parti = String(percorso).split('.');
    const out = {};
    let x = out;
    parti.forEach((p, i) => {
      if (i === parti.length - 1) x[p] = valore;
      else { x[p] = {}; x = x[p]; }
    });
    return out;
  }

  // Consumo medio al giorno per chiave del diario, sui giorni interi degli ultimi sette (come il ritmo: oggi non è
  // finito e abbasserebbe la media). Il primo giorno vale quello di oggi.
  function consumoPerAzione(diario, { oggi = chiaveGiorno() } = {}) {
    const d = diario || {};
    const primo = primoGiorno(d);
    const out = {};
    if (!primo) return out;
    const soloOggi = primo >= oggi;
    let giorni = 0;
    for (let i = soloOggi ? 0 : 1; i <= (soloOggi ? 0 : GIORNI_PER_FUNZIONE); i++) {
      const g = spostaGiorno(oggi, -i);
      if (g < primo) break;
      giorni++;
      for (const [k, v] of Object.entries(d[g] || {})) {
        const r = out[k] || { c: 0, p: 0, o: 0, n: 0, u: 0 };
        r.c += Math.max(0, num(v && v.c));
        r.p += Math.max(0, num(v && v.p));
        r.o += Math.max(0, num(v && v.o));
        r.n += Math.max(0, num(v && v.n));
        r.u += Math.max(0, num(v && v.u));
        out[k] = r;
      }
    }
    const div = Math.max(1, giorni);
    for (const r of Object.values(out)) { r.c /= div; r.p /= div; r.o /= div; r.n /= div; r.u /= div; }
    return out;
  }

  function parseCatena(s) {
    const C = global.SN_CONST;
    if (C && C.parseModelRefs) return C.parseModelRefs(s);
    return String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  }

  function nomeModello(nick, entry) {
    const l = String((entry && entry.label) || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    return l || nick;
  }

  // Regge la funzione? Uscita e ingressi dichiarati; per gli strumenti vale solo un modello che la configurazione
  // mette già nella catena di quella funzione, l'unico segno certo che li sa usare.
  function reggeLaFunzione(nick, entry, azione, catena, cfgRegistry) {
    const Caps = global.SN_MODEL_CAPS;
    const C = global.SN_CONST || {};
    if (!Caps || !entry || !entry.model) return false;
    const req = Caps.requirementsFor(azione);
    const meta = C.entryModalities ? C.entryModalities(entry, nick) : null;
    const caps = Caps.capabilitiesFor(entry.provider || 'openrouter', entry.model, meta);
    const servonoExtra = req.output !== 'text' || (req.inputs || []).length > 0;
    if (caps.uncertain && servonoExtra) return false;
    if (!caps.uncertain) {
      if (!caps.outputs.includes(req.output)) return false;
      for (const i of req.inputs || []) if (!caps.inputs.includes(i)) return false;
    }
    if (req.tools && !catena.includes(nick)) return false;
    // Quello che il modello di adesso dichiara di leggere lo deve leggere anche il sostituto: l'Aiuto manda la foto
    // della pagina a ogni turno anche se la funzione, sulla carta, chiede solo testo.
    const testa = catena[0] && cfgRegistry && cfgRegistry[catena[0]];
    if (testa && testa !== entry) {
      const mt = C.entryModalities ? C.entryModalities(testa, catena[0]) : null;
      const ct = Caps.capabilitiesFor(testa.provider || 'openrouter', testa.model, mt);
      const extra = ct.uncertain ? [] : ct.inputs.filter((i) => i !== 'text');
      for (const i of extra) if (caps.uncertain || !caps.inputs.includes(i)) return false;
    }
    return true;
  }

  // Il modello ammesso più economico per una funzione, col suo consumo di token. `config`: { models, registry,
  // prezzoDi(id) → { input, output } | null, soloPesiAperti }. Torna { nick, nome, daNome, catena, rapporto } o null.
  function modelloPiuEconomico(azione, consumo, config) {
    const cfg = config || {};
    const registry = cfg.registry || {};
    const catena = parseCatena((cfg.models || {})[azione]);
    const primo = catena[0];
    const attuale = primo && registry[primo];
    if (!attuale) return null;
    const prezzo = (e) => (cfg.prezzoDi ? cfg.prezzoDi(e && e.model) : null);
    const p0 = prezzo(attuale);
    if (!p0) return null;
    const pesoIn = Math.max(1, num(consumo && consumo.p));
    const pesoOut = Math.max(1, num(consumo && consumo.o));
    const costo = (p) => pesoIn * num(p.input) + pesoOut * num(p.output);
    const c0 = costo(p0);
    if (c0 <= 0) return null;
    // Un modello che nessuna funzione usa non è una scelta di chi ha messo insieme la configurazione.
    const usati = new Set();
    for (const s of Object.values(cfg.models || {})) for (const n of parseCatena(s)) usati.add(n);
    const C = global.SN_CONST || {};
    const candidati = [];
    for (const [nick, entry] of Object.entries(registry)) {
      if (nick === primo || !entry || !usati.has(nick)) continue;
      if (cfg.soloPesiAperti && C.isOpenWeightsEntry && !C.isOpenWeightsEntry(entry)) continue;
      const p = prezzo(entry);
      if (!p) continue;
      const c = costo(p);
      // Meno del 10% di risparmio non vale una funzione che risponde peggio.
      if (!(c < c0 * 0.9)) continue;
      if (!reggeLaFunzione(nick, entry, azione, catena, registry)) continue;
      candidati.push({ nick, entry, c, inCatena: catena.includes(nick) });
    }
    if (!candidati.length) return null;
    // Prima quelli che la catena della funzione ha già come riserva: chi l'ha scritta li ritiene adatti.
    candidati.sort((x, y) => (Number(y.inCatena) - Number(x.inCatena)) || (x.c - y.c) || x.nick.localeCompare(y.nick));
    const scelto = candidati[0];
    return {
      nick: scelto.nick,
      nome: nomeModello(scelto.nick, scelto.entry),
      daNome: nomeModello(primo, attuale),
      catena: [scelto.nick, ...catena.filter((n) => n !== scelto.nick)].join(', '),
      rapporto: scelto.c / c0,
    };
  }

  function elenco(nomi) {
    if (nomi.length < 2) return nomi.join('');
    return `${nomi.slice(0, -1).join(', ')} e ${nomi[nomi.length - 1]}`;
  }

  function risparmioFrase(n) {
    const r = Math.round(num(n));
    if (r < 1) return 'meno di un credito in meno al giorno';
    return `circa ${fmtInt(r)} crediti in meno al giorno`;
  }

  // I rimedi per questo utente, dal più utile. Entra:
  //   diario, oggi, perGiorno, quota, prossima (da prossimaQuota), chiavePropria,
  //   config (vedi modelloPiuEconomico), impostazioni (per le automatiche accese),
  //   etichetta(azione) → nome della funzione, funzioni: le azioni che l'utente può cambiare.
  // Esce: [{ id, testo, risparmio, dettagli?, cambi? }]. `cambi` è quello che un clic applica.
  function rimedi(dati) {
    const x = dati || {};
    const perAzione = consumoPerAzione(x.diario, { oggi: x.oggi || chiaveGiorno() });
    const out = [];
    const nomeDi = (a) => (x.etichetta ? x.etichetta(a) : a) || a;

    // Le funzioni che consumano di più, unite per azione (la spiegazione anticipata usa il modello della spiegazione).
    const perFunzione = {};
    for (const [k, v] of Object.entries(perAzione)) {
      const a = azioneDi(k);
      const r = perFunzione[a] || { c: 0, p: 0, o: 0 };
      r.c += v.c; r.p += v.p; r.o += v.o;
      perFunzione[a] = r;
    }
    const totale = Object.values(perFunzione).reduce((s, v) => s + v.c, 0);
    const ammesse = new Set(Array.isArray(x.funzioni) ? x.funzioni : Object.keys(perFunzione));
    const ordinate = Object.entries(perFunzione)
      .filter(([a, v]) => ammesse.has(a) && v.c > 0 && v.c >= totale * 0.01)
      .sort((p, q) => q[1].c - p[1].c);
    const modelli = [];
    for (const [a, v] of ordinate) {
      if (modelli.length >= 3) break;
      const m = modelloPiuEconomico(a, v, x.config);
      if (m) modelli.push({ azione: a, nomeFunzione: nomeDi(a), ...m, risparmio: v.c * (1 - m.rapporto) });
    }
    if (modelli.length) {
      const risparmio = modelli.reduce((s, m) => s + m.risparmio, 0);
      out.push({
        id: 'modello',
        testo: `Usa modelli più economici per ${elenco(modelli.map((m) => m.nomeFunzione))}`,
        fatto: `Stai usando modelli più economici per ${elenco(modelli.map((m) => m.nomeFunzione))}`,
        dettagli: modelli.map((m) => `${m.nomeFunzione}: ${m.nome} invece di ${m.daNome}`),
        risparmio,
        cambi: modelli.map((m) => ({ azione: m.azione, catena: m.catena })),
      });
    }

    // Di una chiamata preparata in anticipo si risparmia solo la parte che nessuno ha poi aperto.
    const inutile = (k) => {
      const v = perAzione[k];
      if (!v) return 0;
      if (!/#/.test(k) || !(num(v.n) > 0)) return num(v.c);
      return num(v.c) * (1 - Math.min(num(v.u), num(v.n)) / num(v.n));
    };
    const consumano = automatiche()
      .filter((f) => leggiPercorso(x.impostazioni || {}, f.percorso) === true)
      .map((f) => ({ ...f, c: f.chiavi.reduce((s, k) => s + inutile(k), 0) }))
      .filter((f) => f.c > 0 && f.c >= totale * 0.01)
      .sort((p, q) => q.c - p.c);
    if (consumano.length) {
      out.push({
        id: 'automatiche',
        testo: `Spegni ${elenco(consumano.map((f) => f.nome))}`,
        fatto: `Hai spento ${elenco(consumano.map((f) => f.nome))}`,
        risparmio: consumano.reduce((s, f) => s + f.c, 0),
        cambi: consumano.map((f) => ({ percorso: f.percorso, valore: false })),
      });
    }

    if (!x.chiavePropria) {
      out.push({ id: 'chiave', testo: 'Metti una tua chiave OpenRouter: paghi sul tuo conto e i crediti di Filo restano da parte', risparmio: num(x.perGiorno) });
    }

    const quota = Math.max(0, num(x.quota));
    if (quota > 0) {
      const q = x.prossima && x.prossima.quando ? x.prossima.quando : 'stanotte';
      out.push({ id: 'attesa', testo: `Aspetta la quota del giorno: ${q} arrivano ${fmtInt(quota)} crediti`, risparmio: 0, soloTesto: true });
    }
    for (const r of out) if (r.id === 'modello' || r.id === 'automatiche') r.frase = risparmioFrase(r.risparmio);
    const chiave = out.find((r) => r.id === 'chiave');
    if (chiave) chiave.frase = num(x.perGiorno) >= 1 ? `circa ${fmtInt(x.perGiorno)} crediti di Filo in meno al giorno` : 'i crediti di Filo non scendono più';
    return out.filter((r) => r.soloTesto || r.id === 'chiave' || num(r.risparmio) >= 0.5);
  }

  // L'avviso per intero come testo: la frase e i rimedi con le cifre. Lo legge il modello della chat, così a una
  // risposta a parole («sì, usa i più economici») sa cosa ha proposto; `lista`: le righe come le mostra la UI.
  function perFilo(testo, lista) {
    const righe = [];
    for (const r of Array.isArray(lista) ? lista : []) {
      if (!r || !r.testo) continue;
      righe.push(`- ${r.testo}${r.frase ? ` (${r.frase})` : ''}`);
      for (const d of r.dettagli || []) righe.push(`  ${d}`);
    }
    const t = String(testo || '').trim();
    if (!righe.length) return t;
    return `${t}${t ? '\n' : ''}Per farli durare di più:\n${righe.join('\n')}`;
  }

  global.SN_CREDITI_AVVISO = {
    PREDEFINITI, LIMITI, numeroSoglia, GIORNI_DIARIO, GIORNI_RITMO, GIORNI_PER_FUNZIONE, ANTICIPATA,
    chiaveGiorno, giorniFra, soglieDa, chiaveAzione, azioneDi,
    aggiungi, aggiungiUso, ritmo, proiezione, valuta, sogliaRiarmo, riarmato,
    quando, frase, prossimaQuota,
    automatiche, leggiPercorso, pezzoPer, consumoPerAzione, modelloPiuEconomico, rimedi, risparmioFrase, perFilo,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

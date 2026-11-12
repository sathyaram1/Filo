// La correzione automatica a fine parola (#1447): cosa si corregge da sé quando una parola finisce, la maiuscola di nomi
// e marchi, come scrive chi scrive in quel posto, e cosa Filo impara dai rifiuti. Senza DOM: il cablaggio sta in
// spellcheck.js. Prove: tests/unit/correttoreAutomatica.test.mjs.

(function (global) {
  'use strict';

  const R = () => global.SN_CORRETTORE;

  // Nomi e marchi nella loro forma, per la parola scritta tutta minuscola. Fuori quelli che sono anche parole comuni in
  // italiano o in inglese («rosa», «chiara», «massimo», «apple», «windows», «android»): lì la minuscola può essere giusta.
  const NOMI_ELENCO = [
    // Nomi di persona
    'Alessandro', 'Alberto', 'Aldo', 'Alessio', 'Andrea', 'Antonio', 'Arturo', 'Carlo', 'Christian', 'Claudio', 'Corrado',
    'Cristian', 'Daniele', 'Dario', 'Davide', 'Diego', 'Domenico', 'Edoardo', 'Elia', 'Emanuele', 'Emilio', 'Enrico',
    'Enzo', 'Ettore', 'Fabio', 'Fabrizio', 'Federico', 'Filippo', 'Flavio', 'Francesco', 'Gabriele', 'Gaetano',
    'Giacomo', 'Giancarlo', 'Gianluca', 'Gianni', 'Giorgio', 'Giovanni', 'Giulio', 'Giuseppe', 'Gennaro', 'Ivan',
    'Jacopo', 'Leonardo', 'Lorenzo', 'Luca', 'Luciano', 'Luigi', 'Manuel', 'Marcello', 'Marco', 'Mario', 'Matteo',
    'Mattia', 'Maurizio', 'Mauro', 'Michele', 'Mirko', 'Nicola', 'Nicolò', 'Paolo', 'Pietro', 'Raffaele', 'Riccardo',
    'Roberto', 'Samuele', 'Sergio', 'Simone', 'Stefano', 'Tommaso', 'Umberto', 'Valerio', 'Vincenzo',
    'Vittorio', 'Walter',
    'Alessandra', 'Alessia', 'Alice', 'Anna', 'Antonella', 'Arianna', 'Beatrice', 'Camilla', 'Carla', 'Caterina',
    'Claudia', 'Cristina', 'Daniela', 'Elena', 'Elisa', 'Elisabetta', 'Emma', 'Federica', 'Francesca',
    'Giorgia', 'Giovanna', 'Giulia', 'Greta', 'Ilaria', 'Irene', 'Laura', 'Lucia', 'Manuela', 'Maria',
    'Marta', 'Martina', 'Matilde', 'Michela', 'Monica', 'Noemi', 'Paola', 'Rebecca', 'Rita', 'Roberta',
    'Silvia', 'Simona', 'Sofia', 'Stefania', 'Teresa', 'Valentina', 'Valeria',
    // Città, paesi e regioni
    'Roma', 'Milano', 'Napoli', 'Torino', 'Palermo', 'Genova', 'Bologna', 'Firenze', 'Bari', 'Catania', 'Venezia',
    'Verona', 'Messina', 'Padova', 'Trieste', 'Brescia', 'Parma', 'Taranto', 'Modena', 'Perugia', 'Livorno', 'Ravenna',
    'Cagliari', 'Rimini', 'Salerno', 'Ferrara', 'Sassari', 'Monza', 'Siracusa', 'Pescara', 'Bergamo', 'Trento',
    'Vicenza', 'Bolzano', 'Novara', 'Piacenza', 'Ancona', 'Arezzo', 'Udine', 'Lecce', 'Pesaro', 'Varese', 'Pisa',
    'Lucca', 'Siena', 'Aosta', 'Cremona', 'Mantova', 'Pavia', 'Treviso', 'Londra', 'Parigi', 'Berlino',
    'Madrid', 'Barcellona', 'Lisbona', 'Vienna', 'Praga', 'Amsterdam', 'Bruxelles', 'Atene', 'Dublino', 'Zurigo',
    'Ginevra', 'Tokyo', 'Pechino',
    'Italia', 'Francia', 'Germania', 'Spagna', 'Portogallo', 'Inghilterra', 'Irlanda', 'Olanda', 'Belgio', 'Svizzera',
    'Austria', 'Grecia', 'Polonia', 'Russia', 'Ucraina', 'Cina', 'Giappone', 'India', 'Brasile',
    'Messico', 'Canada', 'Australia', 'Egitto', 'Turchia', 'Svezia', 'Norvegia', 'Danimarca', 'Finlandia', 'Croazia',
    'America', 'Europa', 'Asia', 'Africa', 'Sicilia', 'Sardegna', 'Lombardia', 'Piemonte', 'Liguria', 'Lazio',
    'Campania', 'Puglia', 'Calabria', 'Abruzzo',
    // Marchi
    'Anthropic', 'Claude', 'OpenAI', 'ChatGPT', 'DeepSeek', 'Google', 'Gmail', 'YouTube', 'WhatsApp', 'Facebook',
    'Instagram', 'TikTok', 'LinkedIn', 'Netflix', 'Spotify', 'Amazon', 'Microsoft', 'iPhone', 'iPad', 'iCloud',
    'MacBook', 'macOS', 'Linux', 'Wikipedia', 'GitHub', 'PayPal', 'eBay', 'Airbnb', 'Samsung', 'Huawei', 'Xiaomi',
    'Nintendo', 'PlayStation', 'Xbox', 'Ferrari', 'Lamborghini', 'Vodafone', 'Trenitalia', 'Ryanair', 'Nutella',
    'Barilla', 'Lavazza', 'Firefox', 'Dropbox', 'Reddit', 'Skype', 'Starbucks', 'Coca-Cola',
  ];
  const NOMI = new Map(NOMI_ELENCO.map((f) => [f.toLowerCase(), f]));

  const DI_PAROLA = /[\p{L}\p{M}\p{N}'’-]/u;
  const diParola = (c) => !!c && DI_PAROLA.test(c);
  const PAROLA = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*['’]?/gu;
  // La parola come la confronta chi impara: senza maiuscole e con l'apice dritto.
  const chiave = (p) => String(p ?? '').replace(/’/g, "'").toLowerCase();
  const tuttaMinuscola = (p) => p === p.toLowerCase() && p !== p.toUpperCase();
  // Una forma con maiuscole che non è una sigla: «Giacomo», «iPhone», non «USA».
  const conMaiuscole = (p) => !!p && p !== p.toLowerCase() && p !== p.toUpperCase();

  // Chiudono la parola subito; punto e due punti aspettano lo spazio dopo, perché possono stare dentro un indirizzo, un
  // nome di file o un orario («marco.txt», «10:30»).
  const CHIUDE_SUBITO = /[,;!?)\]»"”…]/u;
  const ASPETTA = /[.:]/;
  // Un pezzo fra due spazi con questi dentro è un indirizzo, un'email, un percorso o un orario: non si tocca.
  const DENTRO_INDIRIZZO = /[./@:\\_=]/;

  // Dove finisce la parola chiusa dal carattere appena battuto in `pos - 1`, o -1 se quel carattere non chiude niente.
  function fineDellaParola(testo, pos) {
    testo = String(testo ?? '');
    const c = testo[pos - 1];
    if (!c || pos < 2) return -1;
    let fine;
    if (/\s/.test(c)) {
      fine = pos - 1;
      if (ASPETTA.test(testo[fine - 1])) fine--;
      else if (!diParola(testo[fine - 1])) return -1;
    } else if (CHIUDE_SUBITO.test(c)) {
      fine = pos - 1;
    } else {
      return -1;
    }
    if (!diParola(testo[fine - 1])) return -1;
    let a = fine;
    while (a > 0 && !/\s/.test(testo[a - 1])) a--;
    return DENTRO_INDIRIZZO.test(testo.slice(a, fine)) ? -1 : fine;
  }

  // La parola che finisce in `fine`: { start, end, parola }, senza l'apice o il trattino davanti.
  function parolaPrima(testo, fine) {
    testo = String(testo ?? '');
    let a = fine;
    while (a > 0 && diParola(testo[a - 1])) a--;
    const pezzo = testo.slice(a, fine);
    let ultima = null;
    for (const m of pezzo.matchAll(PAROLA)) if (m.index + m[0].length === pezzo.length) ultima = m;
    return ultima ? { start: a + ultima.index, end: fine, parola: ultima[0] } : null;
  }

  // La correzione dell'utente che finisce in `fine`, anche su più parole («x es» → «per esempio»), con un confine di
  // parola a sinistra: «es» non scatta dentro «mese». A parità di fine vince la chiave più lunga.
  function chiavePersonale(testo, fine, mappa) {
    const basso = testo.slice(0, fine).toLowerCase();
    let meglio = null;
    for (const k of Object.keys(mappa || {})) {
      if (!k) continue;
      const start = fine - k.length;
      if (start < 0 || basso.slice(start) !== k) continue;
      if (start > 0 && diParola(testo[start - 1])) continue;
      if (!diParola(testo[start])) continue;
      if (!meglio || k.length > meglio.key.length) meglio = { start, key: k };
    }
    return meglio;
  }

  // La forma di nome o marchio di una parola: dall'elenco, dal dizionario dell'utente (dove l'ha scritta con la
  // maiuscola) o dal dizionario del browser, che conosce solo la forma con la maiuscola («Claude», «Netflix»). '' se non
  // è un nome.
  function formaDelNome(parola, { personali = null, sbagliata = null } = {}) {
    const k = chiave(parola);
    if (!k) return '';
    if (NOMI.has(k)) return NOMI.get(k);
    const p = personali && personali.get(k);
    if (p) return conMaiuscole(p) ? p : '';
    if (typeof sbagliata === 'function' && [...k].length >= 3 && /^[\p{Script=Latin}\p{M}'’-]+$/u.test(k) && sbagliata(k)) {
      const c = k[0].toUpperCase() + k.slice(1);
      if (!sbagliata(c)) return c;
    }
    return '';
  }

  // L'articolo o la preposizione attaccati con l'apostrofo: il nome è quello che segue («l'italia» → «l'Italia»).
  const ELISIONE = /^(?:l|d|un|dell|dall|nell|sull|all|coll|pell|quell|quest|bell|sant)['’](?=[\p{L}])/iu;

  // L'apostrofo al posto dell'accento («perche'», «piu'», «sara'»): la forma accentata che il dizionario conosce, o ''.
  // Restano i troncamenti giusti («po'», «di'», «fa'», «de' Medici»). `giusta(p)`: il dizionario dice che p esiste.
  const TRONCHI = new Set(['po', 'mo', 'be', 'di', 'da', 'fa', 'va', 'sta', 'to', 'de', 'ca', 'vo', 'pie']);
  const ACCENTI = { a: ['à'], e: ['è', 'é'], i: ['ì'], o: ['ò'], u: ['ù'] };
  function formaAccentata(parola, giusta) {
    const m = /^(.*?)([aeiou])['’]$/iu.exec(String(parola ?? ''));
    if (!m || typeof giusta !== 'function' || TRONCHI.has(chiave(m[1] + m[2]))) return '';
    const basso = chiave(parola).slice(0, -1);
    for (const acc of ACCENTI[m[2].toLowerCase()]) {
      const c = basso.slice(0, -1) + acc;
      if (giusta(c)) return R().comeScritto(parola, c);
    }
    return '';
  }

  // Una correzione che cambia solo maiuscole: in un posto dove si scrive tutto minuscolo non si fa.
  const soloMaiuscole = (a, b) => a !== b && String(a).toLowerCase() === String(b).toLowerCase();

  // Da dove viene una correzione: i contatori ne tengono una copia (SN_CONTATORI.FONTI_AUTOMATICA, sentinella in
  // tests/unit/contatoriRiquadri.test.mjs).
  const FONTI = Object.freeze(['personale', 'fisso', 'nome']);

  // Cosa correggere quando una parola finisce in `fine`: { start, end, originale, corretta, fonte } o null. Le correzioni
  // dell'utente prima, poi gli errori fissi, poi la maiuscola dei nomi. `rifiutate`: le parole di cui l'utente ha
  // annullato la correzione abbastanza volte; `minuscolo` (o una funzione che lo dice): lì si scrive tutto minuscolo.
  function correzioneAFineParola(testo, fine, {
    personali = {}, rifiutate = new Set(), nomeDi = () => '', minuscolo = false, accento = null,
  } = {}) {
    testo = String(testo ?? '');
    if (typeof fine !== 'number' || fine < 1 || fine > testo.length) return null;
    // Come si scrive lì costa una lettura del testo: si chiede solo se serve.
    let visto = null;
    const qui = () => (visto === null ? (visto = typeof minuscolo === 'function' ? !!minuscolo() : !!minuscolo) : visto);
    const da = Math.max(0, fine - 2000);
    const vicino = testo.slice(da, Math.min(testo.length, fine + 200));
    if (R().zoneEscluse(vicino).some(([a, b]) => da + a < fine && da + b >= fine) || dentroCodice(testo, fine)) return null;
    const p = chiavePersonale(testo, fine, personali);
    if (p && !rifiutate.has(chiave(p.key))) {
      const originale = testo.slice(p.start, fine);
      const corretta = R().comeScritto(originale, String(personali[p.key] ?? ''));
      if (corretta && corretta !== originale && !(soloMaiuscole(originale, corretta) && qui())) {
        return { start: p.start, end: fine, originale, corretta, fonte: 'personale' };
      }
    }
    let w = parolaPrima(testo, fine);
    if (!w) return null;
    // L'apice che chiude una virgoletta non è della parola: «'e'» resta «'e'», «'marco'» diventa «'Marco'».
    if (/['’]$/.test(w.parola) && R().chiudeVirgolette(testo, w.start)) {
      if (w.parola.length < 2) return null;
      w = { start: w.start, end: w.end - 1, parola: w.parola.slice(0, -1) };
    }
    const k = chiave(w.parola);
    if (rifiutate.has(k)) return null;
    const accentata = R().FISSI.has(k) ? '' : formaAccentata(w.parola, accento);
    const giusta = R().FISSI.get(chiave(accentata || w.parola)) || accentata;
    if (giusta) {
      const corretta = R().comeScritto(w.parola, giusta);
      return corretta !== w.parola ? { start: w.start, end: w.end, originale: w.parola, corretta, fonte: 'fisso' } : null;
    }
    const el = ELISIONE.exec(w.parola);
    if (el) {
      w = { start: w.start + el[0].length, end: w.end, parola: w.parola.slice(el[0].length) };
      if (rifiutate.has(chiave(w.parola))) return null;
    }
    if (!tuttaMinuscola(w.parola) || qui()) return null;
    const forma = nomeDi(w.parola);
    return forma && forma !== w.parola ? { start: w.start, end: w.end, originale: w.parola, corretta: forma, fonte: 'nome' } : null;
  }

  // ── Come scrive chi scrive, in quel posto ──────────────────────────────────
  const DOPO_FINE_FRASE = /(?:[.!?…]["'»”)\]]*\s+|\n\s*)["'«“(]*$/u;
  const A_INIZIO_TESTO = /^\s*["'«“(]*$/u;
  // Il pezzo prima della parola in `s` dice che lì comincia una frase.
  function inizioDiFrase(testo, s) {
    const prima = String(testo ?? '').slice(Math.max(0, s - 12), s);
    return DOPO_FINE_FRASE.test(prima) || (s <= 12 && A_INIZIO_TESTO.test(prima));
  }

  // Le maiuscole che mette chi scrive (le correzioni di Filo, in `esclusi`, non contano) e gli inizi di frase minuscoli,
  // nel testo fino a `finoA`. Le sigle («OK») non dicono niente.
  function stileDi(testo, finoA = null, esclusi = []) {
    testo = String(testo ?? '');
    const fino = typeof finoA === 'number' ? Math.max(0, Math.min(finoA, testo.length)) : testo.length;
    const out = { minuscoli: 0, maiuscoli: 0 };
    for (const m of testo.slice(0, fino).matchAll(PAROLA)) {
      const s = m.index;
      const e = s + m[0].length;
      if (esclusi.some((x) => s < x.end && e > x.start)) continue;
      const p = m[0];
      const primo = p[0];
      if (primo !== primo.toLowerCase()) {
        if (conMaiuscole(p) || p.length === 1) out.maiuscoli++;
      } else if (primo !== primo.toUpperCase() && inizioDiFrase(testo, s)) {
        out.minuscoli++;
      }
    }
    return out;
  }

  // Tutto minuscolo apposta: nessuna maiuscola e almeno due inizi di frase minuscoli, o quasi solo minuscole.
  function scriveMinuscolo({ minuscoli = 0, maiuscoli = 0 } = {}) {
    return maiuscoli === 0 ? minuscoli >= 2 : minuscoli >= 4 * maiuscoli;
  }
  // Il testo che si sta scrivendo dice più della pagina: una sua maiuscola o due suoi inizi di frase minuscoli decidono;
  // se dice poco, contano anche i testi già mandati da lì.
  function scriveMinuscoloQui(campo = {}, pagina = {}) {
    if ((campo.maiuscoli || 0) > 0) return false;
    if ((campo.minuscoli || 0) >= 2) return true;
    return scriveMinuscolo({ minuscoli: (campo.minuscoli || 0) + (pagina.minuscoli || 0), maiuscoli: pagina.maiuscoli || 0 });
  }
  // Come si scrive in un posto, sommato ai testi nuovi: oltre il tetto i conti si dimezzano, così pesa il modo recente.
  const STILE_MAX = 40;
  function sommaStile(a, b) {
    const n = (o, k) => { const v = Number(o && o[k]); return Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), STILE_MAX * 4) : 0; };
    let minuscoli = n(a, 'minuscoli') + n(b, 'minuscoli');
    let maiuscoli = n(a, 'maiuscoli') + n(b, 'maiuscoli');
    while (minuscoli + maiuscoli > STILE_MAX) { minuscoli = Math.round(minuscoli / 2); maiuscoli = Math.round(maiuscoli / 2); }
    return { minuscoli, maiuscoli };
  }

  // ── Cosa Filo impara ────────────────────────────────────────────────────────
  // Distanza fra due parole contando anche lo scambio di due lettere vicine; si ferma oltre `tetto`.
  function distanza(a, b, tetto = 2) {
    const x = [...String(a ?? '')];
    const y = [...String(b ?? '')];
    if (Math.abs(x.length - y.length) > tetto) return tetto + 1;
    const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...new Array(y.length).fill(0)]);
    for (let j = 1; j <= y.length; j++) d[0][j] = j;
    for (let i = 1; i <= x.length; i++) {
      let minimo = Infinity;
      for (let j = 1; j <= y.length; j++) {
        const costo = x[i - 1] === y[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
        if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        minimo = Math.min(minimo, d[i][j]);
      }
      if (minimo > tetto) return tetto + 1;
    }
    return d[x.length][y.length];
  }

  // Una parola che Filo può imparare: non un errore fisso e non il refuso di una parola vera («propio», a un tasto da
  // «proprio»). Quanto vicino conta come refuso dipende dalla lunghezza: una parola cortissima ha sempre una parola vera
  // a un tasto («nn», «cmq»), e lì vale solo lo scambio di due lettere («teh»); una lunga sbaglia anche di due
  // («metereologia»).
  const stesseLettere = (a, b) => [...a].sort().join('') === [...b].sort().join('');
  function imparabile(parola, proposte = []) {
    const k = chiave(parola);
    if (!k || R().FISSI.has(k)) return false;
    const n = [...k].length;
    const vicina = (q) => {
      if (n < 4) return q.length === k.length && stesseLettere(q, k) && distanza(q, k, 1) <= 1;
      const tetto = n >= 8 ? 2 : 1;
      return distanza(q, k, tetto) <= tetto;
    };
    return !(proposte || []).some((p) => { const q = chiave(p); return q && q !== k && vicina(q); });
  }

  // Dentro un blocco di codice aperto («```» senza la chiusura) o un codice in linea non ancora chiuso nella riga: lì
  // non si corregge niente.
  function dentroCodice(testo, pos) {
    const prima = String(testo ?? '').slice(0, pos);
    if ((prima.match(/```/g) || []).length % 2 === 1) return true;
    const riga = prima.slice(prima.lastIndexOf('\n') + 1).replace(/```/g, '');
    return (riga.match(/`/g) || []).length % 2 === 1;
  }

  const LIMITE_CONTI = 5000;
  const SOGLIE = Object.freeze({ accettiPerImparare: 3, annulliPerImparare: 2, riscrittePerImparare: 3 });

  // Lo stato di quello che Filo sta imparando, com'è salvato: conti interni e parole di cui non correggere più niente.
  function memoria(m) {
    const ok = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
    const v = ok(m);
    return {
      accettate: { ...ok(v.accettate) },
      annullate: { ...ok(v.annullate) },
      riscritte: { ...ok(v.riscritte) },
      rifiutate: Array.isArray(v.rifiutate) ? v.rifiutate.map(String).filter(Boolean) : [],
    };
  }
  // Un conto nuovo oltre il tetto toglie il più vecchio: sono conti a metà, non dati che l'utente vede.
  function metti(conti, k, v) {
    delete conti[k];
    conti[k] = v;
    const chiavi = Object.keys(conti);
    for (let i = 0; i < chiavi.length - LIMITE_CONTI; i++) delete conti[chiavi[i]];
  }
  const soglia = (n, predefinita) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Math.round(Number(n)) : predefinita);

  // La correzione nella forma da ricordare: «Propio» → «Proprio» si ricorda come «propio» → «proprio».
  function formaBase(parola, correzione) {
    const basso = String(correzione).toLowerCase();
    return R().comeScritto(parola, basso) === correzione ? basso : correzione;
  }

  // Una correzione scelta dall'utente: alla soglia diventa una sua correzione automatica. → { memoria, impara }
  function accettata(m, parola, correzione, quante) {
    const mem = memoria(m);
    const k = chiave(parola);
    const c = String(correzione ?? '').trim();
    if (!k || !c || /\s/.test(k) || c === parola) return { memoria: mem, impara: null };
    if (R().FISSI.get(k) === formaBase(parola, c)) return { memoria: mem, impara: null };
    const base = formaBase(parola, c);
    const id = `${k}\u0001${base}`;
    const n = (Number(mem.accettate[id]) || 0) + 1;
    if (n >= soglia(quante, SOGLIE.accettiPerImparare)) {
      delete mem.accettate[id];
      mem.rifiutate = mem.rifiutate.filter((x) => x !== k);
      return { memoria: mem, impara: { parola: k, correzione: base } };
    }
    metti(mem.accettate, id, n);
    return { memoria: mem, impara: null };
  }

  // Una correzione automatica annullata: alla soglia la parola entra fra quelle da non correggere più. → { memoria, rifiuta }
  function annullata(m, parola, quante) {
    const mem = memoria(m);
    const k = chiave(parola);
    if (!k) return { memoria: mem, rifiuta: false };
    const n = (Number(mem.annullate[k]) || 0) + 1;
    if (n >= soglia(quante, SOGLIE.annulliPerImparare)) {
      delete mem.annullate[k];
      if (!mem.rifiutate.includes(k)) mem.rifiutate.push(k);
      return { memoria: mem, rifiuta: true };
    }
    metti(mem.annullate, k, n);
    return { memoria: mem, rifiuta: false };
  }

  // Una parola fuori dizionario lasciata com'era. Alla soglia si impara nella forma in cui l'utente la scrive: con la
  // maiuscola solo se l'ha scritta così in mezzo a una frase e mai minuscola. → { memoria, impara: forma | null }
  function riscritta(m, parola, { inizioFrase = false } = {}, quante) {
    const mem = memoria(m);
    const k = chiave(parola);
    if (!k) return { memoria: mem, impara: null };
    const prima = mem.riscritte[k] && typeof mem.riscritte[k] === 'object' ? mem.riscritte[k] : {};
    const v = { n: (Number(prima.n) || 0) + 1, maiuscola: Number(prima.maiuscola) || 0, minuscola: Number(prima.minuscola) || 0, forma: prima.forma || '' };
    if (tuttaMinuscola(parola)) v.minuscola++;
    else if (!inizioFrase && conMaiuscole(parola)) { v.maiuscola++; v.forma = parola.replace(/’/g, "'"); }
    if (v.n >= soglia(quante, SOGLIE.riscrittePerImparare)) {
      delete mem.riscritte[k];
      return { memoria: mem, impara: v.maiuscola > 0 && v.minuscola === 0 && v.forma ? v.forma : k };
    }
    metti(mem.riscritte, k, v);
    return { memoria: mem, impara: null };
  }

  // Una parola contata e poi corretta non era lasciata com'era: il suo conto torna indietro.
  function corretta(m, parola) {
    const mem = memoria(m);
    const k = chiave(parola);
    const v = mem.riscritte[k];
    if (!v) return mem;
    const n = (Number(v.n) || 0) - 1;
    if (n <= 0) delete mem.riscritte[k];
    else mem.riscritte[k] = { ...v, n };
    return mem;
  }

  // Tolta una parola dalla pagina del correttore, Filo ricomincia da zero su di lei.
  function dimentica(m, parola) {
    const mem = memoria(m);
    const k = chiave(parola);
    delete mem.riscritte[k];
    delete mem.annullate[k];
    for (const id of Object.keys(mem.accettate)) if (id.split('\u0001')[0] === k) delete mem.accettate[id];
    return mem;
  }

  global.SN_CORRETTORE_AUTO = {
    NOMI, FONTI, SOGLIE, LIMITE_CONTI, chiave, conMaiuscole, fineDellaParola, parolaPrima, chiavePersonale, formaDelNome, formaAccentata,
    soloMaiuscole, correzioneAFineParola, dentroCodice, stileDi, scriveMinuscolo, scriveMinuscoloQui, STILE_MAX, sommaStile, distanza, imparabile, memoria, accettata, annullata,
    riscritta, corretta, dimentica, inizioDiFrase,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

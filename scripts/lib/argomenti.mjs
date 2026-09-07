// Controllo degli argomenti a riga di comando, in un posto solo.
//
// PERCHÉ ESISTE
//   Uno strumento che non riconosce un argomento non deve fare lo stesso la
//   cosa vera. Le porte trovate sul campo (feedback #565), tutte reali:
//     · `--allgea file.md` — l'opzione sparisce, il suo valore scala al posto
//       del titolo e il feedback viene aperto lo stesso;
//     · `-dry-run` con un trattino solo — il giro che doveva essere a vuoto
//       spedisce davvero, e la parola finisce dentro al testo;
//     · «–dry-run» col trattino lungo, che nasce da un copia-incolla da una
//       chat o da un documento — stesso esito;
//     · `--allega` in fondo alla riga, senza il file — sparisce in silenzio.
//   Il danno peggiore non è nei feedback: lo strumento delle chiavi, senza
//   l'opzione giusta, RIGENERA la chiave e i feedback vecchi non si leggono
//   più. Una lettera sbagliata basta.
//
//   La regola è una sola: quello che non capisco lo dico, e non tocco niente.
//
// PURA: nessun accesso al disco, nessuna uscita — ritorna il messaggio da
// stampare (o null se va tutto bene), così ogni strumento decide come uscire.

// Tutti i trattini che una tastiera, un correttore automatico o un
// copia-incolla possono mettere davanti a un'opzione.
const TRATTINI = ['-', '‐', '‑', '‒', '–', '—', '−'];

/** Un argomento «ha l'aria» di un'opzione? PURA. */
export function sembraOpzione(arg) {
  const s = String(arg ?? '');
  if (s.length < 2) return false;                 // «-» da solo è stdin, non un'opzione
  if (!TRATTINI.includes(s[0])) return false;
  // Un numero negativo (-3) non è un'opzione scritta male.
  return !/^[-‐-—−]?\d/.test(s.slice(1));
}

/** La forma normale di un'opzione: due trattini veri, minuscola. PURA. */
export function normalizza(arg) {
  let s = String(arg ?? '');
  let i = 0;
  while (i < s.length && TRATTINI.includes(s[i])) i += 1;
  return `--${s.slice(i)}`;
}

/**
 * `--opzione=valore` → `['--opzione', 'valore']`. PURA.
 *
 * È la forma che regge quando la riga passa da npm, e quindi quella che
 * consigliamo: se la consigliamo deve funzionare anche quando arriva intera,
 * altrimenti chi segue il consiglio si sente rispondere «opzione sconosciuta»
 * seguita dallo stesso consiglio (feedback #565). Tocca solo le opzioni che
 * un valore lo vogliono davvero.
 */
export function espandiUguali(argv, conValore = []) {
  const vuole = new Set(conValore);
  const fuori = [];
  for (const arg of (Array.isArray(argv) ? argv : [])) {
    const s = String(arg ?? '');
    const i = s.indexOf('=');
    const nome = i > 0 ? normalizza(s.slice(0, i)) : '';
    if (i > 0 && sembraOpzione(s) && vuole.has(nome)) fuori.push(nome, s.slice(i + 1));
    else fuori.push(s);
  }
  return fuori;
}

/** Distanza fra due parole: quante correzioni per passare dall'una all'altra. PURA. */
function distanza(a, b) {
  const m = a.length; const n = b.length;
  let riga = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const nuova = [i];
    for (let j = 1; j <= n; j += 1) {
      nuova[j] = Math.min(riga[j] + 1, nuova[j - 1] + 1, riga[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    riga = nuova;
  }
  return riga[n];
}

/**
 * Un'opzione SCRITTA MALE che npm si è mangiato. PURA.
 *
 * Il recupero qui sotto conosce solo i nomi giusti: `--allgea spec.md` finisce
 * a npm, allo strumento non arriva niente, e la cosa vera parte lo stesso —
 * proprio il danno che questo controllo esiste per impedire, sulla strada che
 * si usa davvero. Ma npm il nome sbagliato lo lascia scritto nell'ambiente, e
 * un residuo che dista una o due lettere da un'opzione nostra è il segnale
 * (feedback #565).
 *
 * @returns {string|null} il messaggio da stampare, o null
 */
export function opzioneStorpiata(env = {}, opzioni = []) {
  const nomi = opzioni.map((o) => String(o).replace(/^--/, ''));
  for (const chiave of Object.keys(env)) {
    if (!chiave.startsWith('npm_config_')) continue;
    const nome = chiave.slice('npm_config_'.length).replace(/_/g, '-');
    if (nomi.includes(nome)) continue;                 // scritta giusta: la riprende chi di dovere
    // SOLO i nomi VICINI ai nostri. Il contrario — segnalare tutto ciò che non
    // stia in un elenco delle configurazioni di npm — è stato provato e ha
    // spento OGNI scorciatoia del progetto: npm mette nell'ambiente
    // impostazioni sue che un elenco scritto a mano non contiene mai tutte
    // (`npm_config_global_prefix`, per dirne una), e venivano lette come
    // opzioni digitate da chi lanciava il comando. Un controllo che blocca
    // tutto è peggio del buco che chiude: un nome lontano dai nostri resta
    // fuori portata, e va bene così.
    const vicino = nomi.find((buono) => distanza(nome, buono) <= (buono.length >= 5 ? 2 : 1));
    if (vicino) {
      return `--${nome} non esiste (forse intendevi --${vicino}?) — non ho toccato niente. Passando da npm l'opzione non arriva fin qui: me ne accorgo solo perché npm la lascia scritta nell'ambiente.`;
    }
  }
  return null;
}

/**
 * Le opzioni che npm si è MANGIATO, riprese dall'ambiente. PURA.
 *
 * `npm run feedback:apri --allega spec.md` non passa `--allega` allo
 * strumento: npm se lo prende come roba sua, e allo strumento arrivano le sole
 * parole libere — l'allegato non parte, il nome del file finisce nel testo, e
 * il feedback viene aperto lo stesso. Su PowerShell succede anche con la forma
 * «giusta» (`-- --dry-run`), perché lì i due trattini se li mangia la conchiglia.
 * L'opzione però non sparisce: npm la lascia scritta nell'ambiente. Invece di
 * rifiutare una riga che chi la scrive considera giusta, la RACCOGLIAMO — è
 * quello che voleva — e lo diciamo (feedback #565).
 *
 * @returns {{args: string[], nota: string|null}} i pezzi da aggiungere alla riga
 */
export function argomentiDaNpm(env = {}, { opzioni = [], conValore = [] } = {}) {
  const args = [];
  const prese = [];
  const senzaValore = [];
  const vuole = new Set(conValore);
  for (const opzione of opzioni) {
    const nome = String(opzione).replace(/^--/, '');
    const chiave = [`npm_config_${nome}`, `npm_config_${nome.replace(/-/g, '_')}`]
      .find((k) => env[k] !== undefined && env[k] !== '');
    if (!chiave) continue;
    const valore = String(env[chiave]);
    if (vuole.has(opzione)) {
      // `--allega spec.md` npm lo spezza in due: si tiene il NOME (con «true»
      // al posto del valore) e allo strumento passa il solo valore, che scala
      // sui posizionali e finisce a fare da titolo. Il valore vero qui non
      // c'è, e indovinarlo sarebbe peggio che fermarsi.
      if (valore === 'true' || valore === '') { senzaValore.push(opzione); continue; }
      args.push(opzione, valore);
    } else {
      if (valore !== 'true' && valore !== '') continue;
      args.push(opzione);
    }
    prese.push(opzione);
  }
  if (senzaValore.length) {
    // Qui non si prosegue: proseguire vuol dire aprire un feedback col nome
    // del file per titolo, e il testo vero da un'altra parte.
    return {
      args: [],
      nota: null,
      errore: `${senzaValore.join(' ')} ${senzaValore.length === 1 ? 'è finita' : 'sono finite'} a npm senza il suo valore, e il valore è scivolato sugli altri argomenti — non ho toccato niente. Con npm si scrivono opzione e valore attaccati: ${senzaValore.map((o) => `${o}=<valore>`).join(' ')}`,
    };
  }
  if (!prese.length) return { args: [], nota: null };
  return {
    args,
    nota: `(${prese.join(' ')} ${prese.length === 1 ? 'era finita' : 'erano finite'} a npm invece che a me: ${prese.length === 1 ? "l'ho ripresa" : 'le ho riprese'} dall'ambiente)`,
  };
}

/**
 * Controlla gli argomenti contro le opzioni ammesse.
 *
 * @param {string[]} argv        gli argomenti, senza node e senza lo script
 * @param {string[]} opzioni     le opzioni ammesse, in forma `--nome`
 * @param {string[]} conValore   quelle che pretendono un valore dopo di sé
 * @returns {string|null} il messaggio da stampare, o null se è tutto a posto
 */
export function controllaArgomenti(argv, { opzioni = [], conValore = [] } = {}) {
  const lista = Array.isArray(argv) ? argv.map((a) => String(a ?? '')) : [];
  const ammesse = new Set(opzioni);
  const vuole = new Set(conValore);

  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    // La forma di Windows (`/dry-run`): la riconosciamo solo quando il nome è
    // di un'opzione che conosciamo, per non prendere per un'opzione un
    // percorso che comincia per barra.
    if (arg.startsWith('/') && ammesse.has(`--${arg.slice(1).toLowerCase()}`)) {
      return `l'opzione ${arg} va scritta --${arg.slice(1).toLowerCase()} — non ho toccato niente.`;
    }
    // La conchiglia di Git su Windows trasforma `/dry-run` in un PERCORSO
    // («C:/Program Files/Git/dry-run») prima di consegnarlo: lì la barra non
    // si vede più, e la modalità che non spedisce non si accendeva mentre il
    // feedback partiva davvero (feedback #565). Si guarda l'ultimo pezzo.
    // Solo un PERCORSO ASSOLUTO: un titolo che finisce per «pages/allega» è
    // testo legittimo, e rifiutarlo manda a riscrivere una riga giusta.
    if (/^([A-Za-z]:)?\//.test(arg) && arg.includes('/') && ammesse.has(`--${arg.split('/').pop().toLowerCase()}`)) {
      const nome = arg.split('/').pop().toLowerCase();
      return `«${arg}» è la tua opzione /${nome} trasformata in percorso dalla conchiglia — non ho toccato niente. Scrivila --${nome}.`;
    }
    if (!sembraOpzione(arg)) continue;
    // `--opzione=valore` è la forma che regge quando la riga passa da npm:
    // qui vale come opzione col suo valore, non come un nome sconosciuto.
    const uguale = arg.indexOf('=');
    if (uguale > 0) {
      const conNome = normalizza(arg.slice(0, uguale));
      if (!ammesse.has(conNome)) {
        return `opzione sconosciuta ${arg.slice(0, uguale)} — non ho toccato niente. Ammesse: ${[...ammesse].join(' ')}`;
      }
      if (arg.slice(0, uguale) !== conNome) {
        return `l'opzione ${arg.slice(0, uguale)} va scritta ${conNome} — non ho toccato niente.`;
      }
      if (!vuole.has(conNome)) {
        return `l'opzione ${conNome} non vuole un valore — non ho toccato niente.`;
      }
      if (!arg.slice(uguale + 1)) {
        return `l'opzione ${conNome} vuole un valore dopo di sé — non ho toccato niente.`;
      }
      continue;
    }
    const forma = normalizza(arg);
    if (!ammesse.has(forma)) {
      const vicina = [...ammesse].find((o) => o === forma.toLowerCase());
      return vicina
        ? `opzione sconosciuta ${arg} (forse intendevi ${vicina}?) — non ho toccato niente.`
        : `opzione sconosciuta ${arg} — non ho toccato niente. Ammesse: ${[...ammesse].join(' ')}`;
    }
    // Scritta con un trattino solo o con un trattino lungo: il nome è giusto
    // ma la riga non lo è, e passarci sopra vorrebbe dire indovinare.
    if (arg !== forma) {
      return `l'opzione ${arg} va scritta ${forma} — non ho toccato niente.`;
    }
    if (vuole.has(forma)) {
      const dopo = lista[i + 1];
      if (dopo === undefined || sembraOpzione(dopo)) {
        return `l'opzione ${forma} vuole un valore dopo di sé — non ho toccato niente.`;
      }
      i += 1; // il valore è suo: non lo si esamina come argomento a sé
    }
  }
  return null;
}

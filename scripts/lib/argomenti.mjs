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
    if (!sembraOpzione(arg)) continue;
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

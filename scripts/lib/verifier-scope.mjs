// L'ambito di una verifica (pieno, riallineamento, chiusura): quale testo di
// ruolo riceve e come si scrive il suo perimetro. Lo usano dispatch (routine) e
// verify-local (giro locale): una regola sola per le due strade.

// Un valore che non conosco vale «pieno»: mai meno verifica per un valore storto.
export const VERIFIER_SCOPE_FILE = {
  pieno: 'verifier.md',
  riallineamento: 'verifier-riallineamento.md',
  chiusura: 'verifier-chiusura.md',
};

/** L'ambito riconosciuto, e se quello ricevuto era sconosciuto. PURA. */
export function verifierScope(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === 'pieno') return { scope: 'pieno', sconosciuto: false };
  if (Object.hasOwn(VERIFIER_SCOPE_FILE, s)) return { scope: s, sconosciuto: false };
  return { scope: 'pieno', sconosciuto: true };
}

export const unaRiga = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// Lo sha finisce dentro un comando da copiare: solo esadecimale, o niente. Così il nome di un ramo.
const soloSha = (v) => (/^[0-9a-f]{7,40}$/i.test(unaRiga(v)) ? unaRiga(v) : '');
const soloRamo = (v) => (/^claude\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(unaRiga(v)) ? unaRiga(v) : '');

// Livello E sede, come il lettore della critica li pretende: un perimetro
// scritto senza sede insegnerebbe a chi verifica una forma che poi viene respinta.
const formatoMinimo = (list) => list.map((f) => `- [${f.level}${(['e', 'v'].includes(String(f.sede || '').toLowerCase()) ? String(f.sede).toLowerCase() : 'i')}${f.decision ? '?' : ''}] ${unaRiga(f.text)}`).join('\n');

// La correzione passata anche dal ramo omonimo del server (#1062): il suo diff sta nel checkout di filo-security.
function lineaServer(ramo, sha) {
  if (!ramo) return [];
  return [sha
    ? `La correzione è passata anche dal ramo del server ${ramo}: nel checkout di filo-security il diff è \`git diff ${sha}..${ramo}\`.`
    : `Il ramo del server ${ramo} è nato con la correzione: nel checkout di filo-security il diff è \`git diff origin/main...${ramo}\`.`];
}

// Il commit «verificato» di un riallineamento che non fa da confronto (#1968): lo decide chi ha git sotto mano.
function rigaVerificato(sha, scartato) {
  if (!sha) return 'Commit che aveva passato la verifica: non comunicato.';
  if (scartato === 'punta') {
    return `Commit che aveva passato la verifica: il server ha mandato \`${sha}\`, che è la punta di questo ramo: `
      + 'il diff da lì a `HEAD` è vuoto e non mostra cosa ha cambiato il riallineamento. Il confronto manca: dichiaralo nella critica.';
  }
  if (scartato === 'assente') {
    return `Commit che aveva passato la verifica: \`${sha}\`, ma in questa copia non c'è e da origin non è arrivato. `
      + `Riprova con \`git fetch origin ${sha}\`, poi il diff da leggere è \`git diff ${sha}..HEAD\`; se non arriva, il confronto manca: dichiaralo nella critica.`;
  }
  return `Commit che aveva passato la verifica: \`${sha}\` — il diff da leggere è \`git diff ${sha}..HEAD\`.`;
}

// Il rebase dichiarato nel report che sul ramo non c'è (#2101). Sulla punta verificata il giro non ha niente da provare:
// senza rilievi il lavoro torna alla fusione, che rifà il riallineamento se serve ancora.
// Il report può non nominare lo sha di main: allora lo dice la base vecchia della punta (`baseVecchia`), non la punta
// da sola, che è anche il commit riallineato mandato per errore come verificato (#1968).
function righeRebaseMancante(mancante, scartato, baseVecchia) {
  const shas = (Array.isArray(mancante) ? mancante : []).map(soloSha).filter(Boolean);
  if (!shas.length && !(scartato === 'punta' && baseVecchia)) return [];
  const nominati = shas.map((s) => `\`${s}\``).join(', ');
  const testa = shas.length
    ? `**Il riallineamento non è su questo ramo.** Il report qui sotto dice di aver rifatto la base su \`main\` (${nominati}), ma la punta non contiene quel commit.`
    : '**Il riallineamento non è su questo ramo.** La punta poggia su una base di `main` più vecchia di commit che `main` aveva già quando è stata scritta: nessun rebase l\'ha toccata.';
  if (scartato === 'punta') {
    return ['', testa,
      'La punta è ancora il commit che aveva passato la verifica: in questo giro non c\'è niente da verificare, e i controlli',
      'automatici e le prove dei giri rifarebbero prove già fatte. Non lanciarli: registra la critica senza rilievi, con un riassunto',
      'che dica che il riallineamento non è arrivato sul ramo e che il lavoro è ancora quello verificato, poi rilascia.',
      'Il lavoro torna alla fusione: se passa è fuso, se si ferma di nuovo il riallineamento si rifà, e la consegna ora lo',
      'registra solo se il ramo su origin contiene `main`.'];
  }
  return ['', testa,
    'Quello che c\'è dopo il commit verificato non viene da un rebase: verificalo come sempre, e nella critica scrivi un',
    'rilievo interno di livello 2 che dica che il riallineamento dichiarato manca dal ramo.'];
}

/**
 * Il perimetro di un giro stretto, scritto come testo in coda al compito: un
 * JSON nel payload si può non guardare, un'istruzione no. '' per il giro
 * pieno. `scartato`: perché il commit verificato non fa da confronto ('punta', 'assente'); `mancante`: i commit di
 * main che il report dichiara e la punta non contiene; `baseVecchia`: la punta è nata su un main già superato. PURA.
 */
export function perimetroNote(scope, perimetro, formatFindings = formatoMinimo, { scartato = '', mancante = [], baseVecchia = false } = {}) {
  const p = perimetro && typeof perimetro === 'object' ? perimetro : {};
  if (scope === 'chiusura') {
    const rilievi = Array.isArray(p.rilievi) ? p.rilievi.filter((r) => r && unaRiga(r.text)) : [];
    const sha = soloSha(p.shaPrima);
    return [
      '## Perimetro di questo giro',
      '',
      'Rilievi corretti nel giro prima:',
      rilievi.length
        ? formatFindings(rilievi)
        : '  (non comunicati: ricavali dall\'ultima critica dei giri passati, e dillo nella tua)',
      '',
      sha
        ? `Commit di partenza della correzione: \`${sha}\` — il diff da leggere è \`git diff ${sha}..HEAD\`.`
        : 'Commit di partenza della correzione: non comunicato.',
      // Un ramo riallineato fuori da qui (in cloud, o a mano) porta main nel diff: va detto.
      ...(sha ? ['Se in quel diff trovi modifiche che non c\'entrano coi rilievi, dopo la correzione il ramo è stato',
        'riallineato a `main`: ti interessano solo dove toccano la correzione.'] : []),
      ...lineaServer(soloRamo(p.ramoServer), soloSha(p.shaPrimaServer)),
    ].join('\n');
  }
  if (scope === 'riallineamento') {
    const sha = soloSha(p.shaVerificato);
    const report = String(p.reportRebase ?? '').trim();
    const conDiff = !!sha && scartato !== 'punta';
    const rebaseMancante = righeRebaseMancante(mancante, scartato, baseVecchia);
    return [
      '## Perimetro di questo giro',
      '',
      // Sulla punta verificata senza rebase la riga del confronto mancante chiederebbe un rilievo che non serve.
      rebaseMancante.length && scartato === 'punta' ? `Commit che aveva passato la verifica: \`${sha}\`, la punta di questo ramo.` : rigaVerificato(sha, scartato),
      ...rebaseMancante,
      '',
      'Cosa ha scritto chi ha rifatto la base (dove c\'erano i conflitti, se ha toccato la logica, quali unit erano rossi dopo il rebase):',
      report
        ? report.split('\n').map((l) => `> ${l}`).join('\n')
        : conDiff
          ? '  (nessun report: le zone in conflitto le ricavi dal diff; senza nemmeno quello, dichiaralo nella critica)'
          : '  (nessun report e nessun confronto: cerca le zone fra i file del lavoro, `git diff --stat origin/main...HEAD`, e nella critica dichiara che il confronto mancava)',
    ].join('\n');
  }
  return '';
}

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

const formatoMinimo = (list) => list.map((f) => `- [${f.level}${f.decision ? '?' : ''}] ${unaRiga(f.text)}`).join('\n');

/**
 * Il perimetro di un giro stretto, scritto come testo in coda al compito: un
 * JSON nel payload si può non guardare, un'istruzione no. '' per il giro
 * pieno. PURA.
 */
export function perimetroNote(scope, perimetro, formatFindings = formatoMinimo) {
  const p = perimetro && typeof perimetro === 'object' ? perimetro : {};
  if (scope === 'chiusura') {
    const rilievi = Array.isArray(p.rilievi) ? p.rilievi.filter((r) => r && unaRiga(r.text)) : [];
    const sha = unaRiga(p.shaPrima);
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
    ].join('\n');
  }
  if (scope === 'riallineamento') {
    const sha = unaRiga(p.shaVerificato);
    const report = String(p.reportRebase ?? '').trim();
    return [
      '## Perimetro di questo giro',
      '',
      sha
        ? `Commit che aveva passato la verifica: \`${sha}\` — il diff da leggere è \`git diff ${sha}..HEAD\`.`
        : 'Commit che aveva passato la verifica: non comunicato.',
      '',
      'Cosa ha scritto chi ha risolto il conflitto (dove c\'erano i conflitti, e se ha toccato la logica):',
      report
        ? report.split('\n').map((l) => `> ${l}`).join('\n')
        : '  (nessun report: le zone in conflitto le ricavi dal diff; senza nemmeno quello, dichiaralo nella critica)',
    ].join('\n');
  }
  return '';
}

// Il costo di un'operazione in unità di un lavoro di riferimento misurato accanto, nello stesso processo: una macchina
// carica rallenta tutti e due, e il rapporto resta. Non dà millisecondi da confrontare con un numero fisso.
// Regola e racconto: patterns/un-test-chiede-al-sistema-non-presume-quello-su-cui-e-nato.md (#943).

export const GIRI = 5;

const TESTO = 'Il codice 482913 scade alle 12:00; rif. ABC-123, https://example.com/a?b=1&c=due.\n'.repeat(1500);
const REGOLE = [/\d+/g, /\b\w+\b/g, /https?:\/\/\S+/g];
let pozzo = 0;

/** Regex e stringhe, lo stesso genere di lavoro delle prove che la usano; il risultato finisce in `pozzo` perché V8 non lo salti. */
export function unitaDiRiferimento() {
  let n = 0;
  for (const r of REGOLE) n += TESTO.match(r).length;
  pozzo = (pozzo + n) % 1e9;
  return n;
}

function misura(fn, ora) {
  const t = ora();
  fn();
  return ora() - t;
}

/**
 * Quante unità costa `op`, misurata fra due unità di riferimento (vale la più lenta, che ha visto lo stesso carico).
 * Si ripete solo se il giro supera `tetto`, fino a `giri` volte, e vale il giro migliore: un'operazione lenta lo è a
 * ogni giro, un carico passeggero no.
 */
export function costoInUnita(op, { tetto = Infinity, giri = GIRI, ora = () => performance.now(), riferimento = unitaDiRiferimento } = {}) {
  let migliore = { unita: Infinity, ms: 0, msRif: 0 };
  let fatti = 0;
  while (fatti < giri) {
    fatti++;
    const prima = misura(riferimento, ora);
    const ms = misura(op, ora);
    const msRif = Math.max(prima, misura(riferimento, ora), Number.EPSILON);
    if (ms / msRif < migliore.unita) migliore = { unita: ms / msRif, ms, msRif };
    if (migliore.unita <= tetto) break;
  }
  const entro = migliore.unita <= tetto;
  const come = `${migliore.unita.toFixed(1)} unità di riferimento (tetto ${tetto}): ${migliore.ms.toFixed(1)} ms contro ${migliore.msRif.toFixed(1)} ms, giro migliore di ${fatti}`;
  return { ...migliore, entro, giri: fatti, come };
}

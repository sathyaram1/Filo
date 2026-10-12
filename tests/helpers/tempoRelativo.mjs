// Il costo di un'operazione in unità di un lavoro di riferimento misurato accanto, nello stesso processo: una macchina
// carica rallenta tutti e due, e il rapporto resta. Non dà millisecondi da confrontare con un numero fisso.
// Regola e racconto: patterns/un-test-chiede-al-sistema-non-presume-quello-su-cui-e-nato.md (#943).

export const GIRI = 5;

const TESTO = 'Il codice 482913 scade alle 12:00; rif. ABC-123, https://example.com/a?b=1&c=due.\n'.repeat(6000);
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
 * ogni giro, un carico passeggero no. Un'operazione che ricorda il proprio input va rifatta su un input nuovo a ogni
 * giro, o dal secondo si misura la memoria.
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

/**
 * Quante volte `b` costa più di `a`: due lavori asincroni misurati a turno, campione per campione, così un carico
 * passeggero cade su tutti e due. Vale il campione migliore di ciascuno, e il giro si ripete solo se il rapporto supera
 * `tetto`, fino a `giri` volte: un costo che cresce davvero sfora a ogni giro.
 */
export async function rapportoFraCosti(a, b, { tetto = Infinity, campioni = 15, giri = GIRI, ora = () => performance.now() } = {}) {
  const misuraAsync = async (fn) => { const t = ora(); await fn(); return ora() - t; };
  let migliore = { rapporto: Infinity, msA: 0, msB: 0 };
  let fatti = 0;
  while (fatti < giri) {
    fatti++;
    let minA = Infinity;
    let minB = Infinity;
    for (let i = 0; i < campioni; i++) {
      // L'ordine si alterna: chi viene secondo trova le cache scaldate dal primo.
      if (i % 2) { minB = Math.min(minB, await misuraAsync(b)); minA = Math.min(minA, await misuraAsync(a)); }
      else { minA = Math.min(minA, await misuraAsync(a)); minB = Math.min(minB, await misuraAsync(b)); }
    }
    const rapporto = minB / Math.max(minA, Number.EPSILON);
    if (rapporto < migliore.rapporto) migliore = { rapporto, msA: minA, msB: minB };
    if (migliore.rapporto <= tetto) break;
  }
  const entro = migliore.rapporto <= tetto;
  const come = `${migliore.rapporto.toFixed(2)} volte (tetto ${tetto}): ${migliore.msB.toFixed(2)} ms contro ${migliore.msA.toFixed(2)} ms, giro migliore di ${fatti}`;
  return { ...migliore, entro, giri: fatti, come };
}

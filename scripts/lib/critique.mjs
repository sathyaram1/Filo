// critique.mjs — il tetto al testo della critica, in un posto solo.
//
// IL GUASTO CHE TOGLIE (#531)
//   La critica del verificatore viaggia su più mani: finisce nella nota della
//   conversazione del feedback, e — quando i rilievi non risolti diventano un
//   feedback a parte — nel testo di quel feedback. Ogni mano si teneva il suo
//   `slice(0, 4000)`, scritto a mano, senza dirlo a nessuno. Su #509 la critica
//   si è fermata a metà parola («…chiusa da set») e il feedback residuo #529 ha
//   portato il terzo rilievo monco: chi lo lavorava non poteva sapere cosa
//   chiedeva il verificatore su quel punto. Il danno è stato zero solo perché il
//   correttore ha letto il test che il verificatore aveva lasciato.
//
// LE DUE REGOLE
//   1. UN valore solo, dichiarato dove lo legge anche il server
//      (src/shared/feedbackTransitions.js, che filo-security incorpora al
//      deploy): tetti scritti a mano in punti diversi divergono, e quando
//      divergono il testo si accorcia a ogni passaggio senza che si veda.
//   2. Un taglio si VEDE. Se il tetto viene superato davvero, al posto di ciò
//      che manca c'è un segno — chi legge sa di stare leggendo un pezzo, e non
//      scambia una frase interrotta per la fine del discorso.
//
// Il taglio non spezza nemmeno l'ultima parola: torna all'ultimo spazio vicino.
// È una cortesia piccola, ma è esattamente il sintomo da cui questo file nasce.

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { TOOLS_ROOT } from './tools-pin.mjs';

// Paracadute per un checkout che non ha ancora la fonte unica (clone vecchio):
// stessi valori, così il comportamento non cambia di nascosto.
const FALLBACK = { max: 12000, mark: '\n…(testo tagliato)' };

/** Il tetto e il segno, dalla fonte unica. Non lancia mai. */
export function critiqueLimits() {
  try {
    const req = createRequire(import.meta.url);
    // Dagli STRUMENTI, non dal progetto: come per i contatori del verificatore,
    // è un dato che governa il giro, e preso dal ramo di lavoro sarebbe la
    // versione di giorni fa (lib/tools-pin.mjs).
    req(resolve(TOOLS_ROOT, 'src', 'shared', 'feedbackTransitions.js'));
    const d = globalThis.SN_FB_TRANSITIONS;
    const max = d && Number(d.CRITIQUE_MAX);
    const mark = d && typeof d.CRITIQUE_CUT_MARK === 'string' ? d.CRITIQUE_CUT_MARK : '';
    if (Number.isFinite(max) && max > 0 && mark) return { max, mark };
  } catch (_) { /* niente fonte unica: si usa il paracadute */ }
  return { ...FALLBACK };
}

/**
 * Porta un testo sotto il tetto, lasciando un segno se ha dovuto tagliare.
 * PURA (i limiti si possono passare: è così che la testano gli unit test).
 *
 * @param {string} text
 * @param {{max?:number, mark?:string}} [limits]
 * @returns {string} lungo al massimo `max` caratteri, segno compreso
 */
export function capCritique(text, limits = critiqueLimits()) {
  const max = Number.isFinite(Number(limits?.max)) && Number(limits.max) > 0
    ? Number(limits.max) : FALLBACK.max;
  const mark = typeof limits?.mark === 'string' && limits.mark ? limits.mark : FALLBACK.mark;
  const s = String(text == null ? '' : text);
  if (s.length <= max) return s;
  // Il segno sta DENTRO il tetto: il risultato non può essere più lungo del
  // limite che si è appena dichiarato di rispettare.
  const room = Math.max(0, max - mark.length);
  let cut = s.slice(0, room);
  const lastSpace = cut.search(/\s\S*$/);
  // Solo se lo spazio è vicino alla fine: su un testo senza spazi (un blob,
  // un log) tornare indietro all'infinito butterebbe via tutto.
  if (lastSpace > 0 && room - lastSpace <= 200) cut = cut.slice(0, lastSpace);
  return cut.replace(/\s+$/, '') + mark;
}

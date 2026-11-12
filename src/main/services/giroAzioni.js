// Come partono le azioni di un giro della chat: aperture di pagina e letture di fila insieme, il resto una dopo l'altra
// perché i suoi esiti decidono i passi dopo; quando un giro chiude il turno, e quando una nota era la risposta.
// Prove: tests/unit/giroAzioni.test.mjs.
'use strict';

// Le letture si controllano contro quello che il modello aveva davanti a inizio giro (#1097.2): gli esiti di questo giro
// non li ha ancora visti, quindi non possono essere finiti in una sua query. Le altre azioni vedono anche quelli.
//   avvia(azione, { contesto, fonti }) → promessa dell'esito
//   dopo(azione, esito)                → lo consegna (e di solito lo aggiunge a `contesto`)
//   fermo()                            → vero se l'utente ha fermato: le azioni non ancora partite non partono
async function eseguiGiro(azioni, { contesto, fonti, avvia, dopo, fermo = () => false, apertura, lettura }) {
  const inizio = { contesto: contesto.slice(), fonti: fonti.slice() };
  const esiti = new Map();
  // Un guasto di un'azione partita insieme alle altre risale quando tocca a lei, non prima e non perso.
  const lancia = (a, ctx) => { const p = avvia(a, ctx); p.catch(() => {}); esiti.set(a, p); };
  for (let i = 0; i < azioni.length; i++) {
    const a = azioni[i];
    if (!esiti.has(a)) {
      if (fermo()) return { fermato: true };
      if (apertura(a)) for (let j = i; j < azioni.length && apertura(azioni[j]); j++) lancia(azioni[j], { contesto, fonti });
      else if (lettura(a)) for (let j = i; j < azioni.length && lettura(azioni[j]); j++) lancia(azioni[j], inizio);
      else lancia(a, { contesto, fonti });
    }
    await dopo(a, await esiti.get(a));
  }
  return { fermato: false };
}

// Un giro chiude il turno senza richiamare il modello quando ogni sua azione ha già detto tutto (#1130): riuscita fra
// quelle che parlano da sé (SN_ACTION_LEVELS.TERMINALI), o ferma sulla conferma dell'utente, col suo pulsante in chat.
// Un esito da leggere, un errore, un rifiuto o una domanda in un'azione qualunque e il modello riparte. Così anche una
// conferma col testo del giro: scritto prima di sapere che serviva l'OK, poteva dare per fatto quello che aspetta.
//   esiti     → [{ action, res, rendered }] nell'ordine del giro
//   daLeggere → vero se l'esito porta al modello qualcosa da leggere
//   testo     → quello che il modello ha scritto insieme alle azioni
function chiudeIlTurno(esiti, { daLeggere = () => false, testo = '' } = {}) {
  const L = globalThis.SN_ACTION_LEVELS;
  if (!L || !Array.isArray(esiti) || !esiti.length) return false;
  if (String(testo || '').trim() && esiti.some((e) => e && e.res && e.res.needsConfirm)) return false;
  return esiti.every((e) => {
    const res = e && e.res;
    if (!res || res.rejected || res.no || res.domanda || (res.output && res.output.blocked) || daLeggere(e)) return false;
    return !!res.needsConfirm || L.parlaDaSe(e.action && e.action.type, res);
  });
}

// La risposta scritta insieme alle azioni, finita fra le note e non riscritta dall'ultimo giro (#1921.1): GLM a volte
// chiude con la sola battuta che segue («Torniamo a noi: chi sei?»). Misurato con GLM: le riscritte stavano sopra il
// 90% della nota, le battute sole sotto il 15%; le note di lavoro vere («Guardo il documento…») sotto i 100 caratteri.
const NOTA_DA_RISPOSTA = 150;
const FINALE_CHE_NON_LA_RIPORTA = 1 / 2;
function rispostaFraLeNote(note, finale) {
  const lunga = (Array.isArray(note) ? note : []).map((n) => String(n || '').trim())
    .reduce((a, n) => (n.length > a.length ? n : a), '');
  if (lunga.length < NOTA_DA_RISPOSTA) return '';
  return String(finale || '').trim().length < lunga.length * FINALE_CHE_NON_LA_RIPORTA ? lunga : '';
}

module.exports = { eseguiGiro, chiudeIlTurno, rispostaFraLeNote };

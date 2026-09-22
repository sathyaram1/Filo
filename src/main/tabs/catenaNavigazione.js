// La catena di navigazioni di una scheda: chi consuma i controlli costosi.
// Non tiene stato suo, lo scrive sulla scheda; logica pura, provabile senza
// Electron (tests/unit/catenaNavigazione.test.mjs).

'use strict';

// #591, settimo giro. I conti dei controlli che Filo fa partire da solo erano
// una velocità e non un tetto: la finestra comune si riapriva ogni pochi
// secondi, e una pagina che si porta da sola su indirizzi sempre nuovi poteva
// tenerla piena per sempre, fino a svuotare il tetto mensile e con lui tutta
// l'AI di Filo. Il conto va tenuto dove sta chi lo consuma. Sessanta
// navigazioni di fila nella stessa scheda sono UNA pagina che si porta in
// giro, e si riconosce dal tempo: non lascia mai passare i secondi che servono
// a una persona per guardare cosa è arrivato. Chi naviga dopo una pausa apre
// una catena nuova, col suo conto intero, quindi la truffa che l'utente
// raggiunge da sé riceve sempre il suo controllo.
const PAUSA_MS = 8000;

function catenaDi(tab, ora = Date.now()) {
  if (!tab) return '';
  const c = tab._catenaNav;
  if (!c || ora - c.ultima > PAUSA_MS) {
    tab._catenaNav = { id: `${tab.id}:${ora}:${Math.random().toString(36).slice(2, 8)}`, ultima: ora };
  } else {
    c.ultima = ora;
  }
  return tab._catenaNav.id;
}

module.exports = { catenaDi, PAUSA_MS };

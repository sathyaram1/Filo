// Le risposte di Filo arrivate a pannello chiuso o ridotto, per scheda e per fonte (#1432): la striscia della barra
// laterale resta accesa finché l'utente non le apre. Il documento nuovo, o la scheda chiusa, le porta via.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

// Chi può dire «c'è una risposta da leggere»: l'Aiuto della pagina, e il pannello di destra delle app di Filo.
const FONTI = Object.freeze(['aiuto', 'app']);

// true se è cambiato qualcosa.
function segna(tab, fonte, attesa) {
  if (!tab || !FONTI.includes(fonte)) return false;
  const prima = !!(tab._risposteInAttesa && tab._risposteInAttesa.has(fonte));
  if (prima === !!attesa) return false;
  if (!tab._risposteInAttesa) tab._risposteInAttesa = new Set();
  if (attesa) tab._risposteInAttesa.add(fonte);
  else tab._risposteInAttesa.delete(fonte);
  return true;
}

function inAttesa(tab, fonte = null) {
  const s = tab && tab._risposteInAttesa;
  if (!s || !s.size) return false;
  return fonte ? s.has(fonte) : true;
}

function dimentica(tab) {
  if (!tab || !tab._risposteInAttesa || !tab._risposteInAttesa.size) return false;
  tab._risposteInAttesa = null;
  return true;
}

module.exports = { FONTI, segna, inAttesa, dimentica };

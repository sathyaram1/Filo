// Tetto per scheda sulle chiamate al modello che partono da sole da una pagina (#1070): la difesa che resta se un
// sito trova un modo di farle partire senza l'utente. Si conta qui, perché un limite contro l'abuso di una pagina non
// si conta dentro quella pagina. Il tasto destro (`suRichiesta`) non si ferma mai. Regola: patterns/una-chiamata-che-spende-parte-da-un-gesto-vero.md.

const FINESTRA_MS = 60 * 1000;
// Dimensionati sul caso peggiore di chi usa Filo davvero, col doppio di margine: una selezione al secondo per un
// minuto intero; chi scrive a 100 parole al minuto, con un controllo per parola e quelli dopo ogni pausa.
const GRUPPI = Object.freeze({
  explain: 'spiegazioni',
  spellcheck_semantic: 'correttore',
  spellcheck_word: 'correttore',
});
const TETTI = Object.freeze({ spiegazioni: 120, correttore: 300 });

function crea({ ora = () => Date.now() } = {}) {
  const perScheda = new Map(); // id del webContents → { gruppo: [istanti] }
  const avvisate = new Set();  // `${id}|${gruppo}` già avvisate in questa pausa

  // Torna null se la chiamata passa (e la conta), altrimenti { gruppo, tetto, primo }: `primo` vale una volta per pausa.
  function passa(msg, wc) {
    const gruppo = msg && GRUPPI[msg.action];
    if (!gruppo || msg.suRichiesta === true || !wc || typeof wc.id !== 'number') return null;
    let conti = perScheda.get(wc.id);
    if (!conti) {
      conti = {};
      perScheda.set(wc.id, conti);
      try { wc.once('destroyed', () => { perScheda.delete(wc.id); for (const g of Object.values(GRUPPI)) avvisate.delete(`${wc.id}|${g}`); }); } catch (_) {}
    }
    const adesso = ora();
    const istanti = (conti[gruppo] || []).filter((t) => adesso - t < FINESTRA_MS);
    conti[gruppo] = istanti;
    const chiave = `${wc.id}|${gruppo}`;
    if (istanti.length >= TETTI[gruppo]) {
      const primo = !avvisate.has(chiave);
      avvisate.add(chiave);
      return { gruppo, tetto: TETTI[gruppo], primo };
    }
    avvisate.delete(chiave);
    istanti.push(adesso);
    return null;
  }

  return { passa };
}

module.exports = { crea, FINESTRA_MS, GRUPPI, TETTI };

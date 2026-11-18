// Una mossa di Haiku eseguita su Filo (tests/agent/prova.mjs), e dove va la tastiera dopo: alla superficie dell'ultimo
// clic, come per una persona, e alla scheda attiva dopo un tasto che Filo si è preso (una scheda nuova, una chiusa).
// Prova: tests/prova-da-utente-filo.spec.mjs.

import * as d from './driver.mjs';

/** Esegue `mossa` coi segni di `map`; `fuoco` è la Page che riceve i tasti (null: la scheda attiva). Ritorna il fuoco nuovo. */
export async function eseguiMossa(app, shell, mossa, map, fuoco) {
  const m = mossa.segno != null ? map.find((x) => x.i === mossa.segno) : null;
  if (m) mossa.etichetta = m.label || m.tag;
  switch (mossa.azione) {
    case 'clic': return d.clickMark(app, shell, map, mossa.segno);
    case 'destro': return d.clickMark(app, shell, map, mossa.segno, { button: 'right' });
    case 'doppio': return d.clickMark(app, shell, map, mossa.segno, { clickCount: 2 });
    case 'scrivi': {
      const dove = mossa.segno != null ? await d.clickMark(app, shell, map, mossa.segno) : fuoco;
      await d.typeText(app, shell, mossa.testo, dove);
      return dove;
    }
    case 'tasto': return (await d.pressKey(app, shell, mossa.tasto, fuoco)) ? null : fuoco;
    case 'scorri': await d.scrollBy(app, shell, mossa.dy); return fuoco;
    case 'aspetta': await d.sleep(mossa.secondi * 1000); return fuoco;
    default: return fuoco;
  }
}

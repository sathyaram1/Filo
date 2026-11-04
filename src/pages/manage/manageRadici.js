// Le radici della fiducia sul cartellino di Gestione (#1918, SPEC-DOMANDE.md §1.8): nome, perché e chip di ogni
// radice, uguali su feedback e domande. Non chiama il server: chi disegna dice cosa fare al clic.

(function () {
  'use strict';

  function etichetta(x) {
    if (x.tipo === 'legacy') return 'nato prima';
    if (x.tipo === 'ignota') return 'provenienza ignota';
    if (x.tipo === 'feedback') return `#${x.valore}`;
    // Quello che una sessione dichiara arriva come segno (#…), col nome a parte: sul cartellino il nome.
    const valore = x.nome ? String(x.nome).slice(String(x.nome).indexOf(':') + 1) : x.valore;
    if (x.tipo === 'web') {
      if (/^ricerca /.test(valore)) return 'ricerca web';
      try { return new URL(valore).hostname || 'pagina web'; } catch (_) { return 'pagina web'; }
    }
    if (x.sessione === true) return 'sessione sporca';
    return { posta: 'posta', file: 'file esterno', mcp: `strumento ${valore}`, esterno: 'esterno' }[x.tipo] || x.tipo;
  }

  // Quello che il server ha annotato quando la sessione si è sporcata: senza, l'owner timbrerebbe alla cieca.
  function letturaDellaSessione(x) {
    const l = Array.isArray(x.letture) ? x.letture.map((m) => String(m || '').trim()).filter(Boolean) : [];
    if (!l.length) return `Una sessione ha letto qualcosa senza dire cosa (${x.valore}), e il server non l’ha annotato.`;
    const prima = Number(x.lettureTolte) > 0 ? `${x.lettureTolte} più vecchie e ` : '';
    return `Quello che una sessione ha letto senza dire da dove: ${prima}${l.map((m) => `«${m}»`).join('; ')}.`;
  }

  function titolo(x) {
    const cosa = x.tipo === 'legacy' ? 'Nato prima delle radici (24/10), da catene che hai già letto.'
      : x.tipo === 'ignota' ? 'Il server non sa da dove viene: nessun timbro la toglie.'
        : x.tipo === 'feedback' ? `Il testo dell’utente di #${x.valore}: leggilo prima di timbrarlo.`
          : x.sessione === true ? letturaDellaSessione(x)
            : `${x.nome || x.valore}: guardalo prima di timbrarlo.`;
    if (x.tipo === 'ignota') return cosa;
    const effetto = x.tipo === 'legacy' ? 'Un clic timbra in blocco tutto ciò che è nato prima' : 'Un clic la timbra per tutto ciò che la porta';
    return x.timbrata ? `${cosa} Timbrata: un clic toglie il timbro, ovunque.` : `${cosa} ${effetto}.`;
  }

  /** Riempie `box` coi chip di `lista`; `alClic(x)` timbra o toglie. Senza radici il box si nasconde. */
  function disegna(box, lista, alClic) {
    if (!box) return;
    box.textContent = '';
    // Una lettura una radice: tre pagine dello stesso sito sono tre chip, e senza un numero sembrerebbero uno.
    const quante = new Map();
    for (const x of lista) quante.set(etichetta(x), (quante.get(etichetta(x)) || 0) + 1);
    const viste = new Map();
    for (const x of lista) {
      const nome = etichetta(x);
      viste.set(nome, (viste.get(nome) || 0) + 1);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mg-radice';
      b.dataset.radice = x.radice;
      b.textContent = `${x.timbrata ? '✓ ' : ''}${nome}${quante.get(nome) > 1 ? ` ${viste.get(nome)}` : ''}`;
      b.title = titolo(x);
      b.setAttribute('aria-pressed', x.timbrata ? 'true' : 'false');
      b.disabled = x.timbrabile === false;
      b.addEventListener('click', () => alClic(x));
      box.appendChild(b);
    }
    box.hidden = !lista.length;
  }

  // Un timbro ricalcola feedback e domande insieme: le radici lette prima, da qualunque sezione, valgono fino al prossimo.
  let epoca = 0;
  const invalida = () => { epoca += 1; };
  const firma = (id, fiducia) => `${epoca}|${id}|${fiducia || ''}`;

  window.SN_MANAGE_RADICI = { etichetta, titolo, disegna, invalida, firma };
})();

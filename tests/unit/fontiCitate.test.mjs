// Le fonti citate nelle risposte (#2383): il controllo del marcatore lo fa il codice, e il renderer disegna
// l'etichetta solo dalle fonti controllate, mai da quello che il modello scrive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'sitiComuni.js'));
require(join(ROOT, 'src', 'shared', 'fontiCitate.js'));
require(join(ROOT, 'src', 'shared', 'filoMarkdown.js'));
require(join(ROOT, 'src', 'shared', 'constants.js'));
const F = globalThis.SN_FONTI_CITATE;
const MD = globalThis.SN_MARKDOWN;

const URL_WIKI = 'https://it.wikipedia.org/wiki/Donald_Trump';
const PAGINA = 'Donald John Trump è un imprenditore. Il 16 giugno 2015 annuncia la candidatura alle primarie del Partito Repubblicano, con l’appoggio di pochi.';

function lettura(url, testo, extra = {}) {
  const output = { pageRead: url, ok: true, url, titolo: 'Donald Trump - Wikipedia', testo, ...extra };
  return { type: 'LEGGI_PAGINA', url, _output: output };
}

test('una citazione con spazi, a capo e virgolette diverse si verifica, e il marcatore diventa un\'etichetta dopo la frase', () => {
  const s = F.sorgenti([lettura(URL_WIKI, PAGINA)]);
  const frase = 'Annuncia la candidatura nel giugno 2015.';
  const r = F.controlla(`${frase} [[fonte: ${URL_WIKI} | «annuncia   la candidatura\nalle primarie del Partito Repubblicano, con l'appoggio»]]`, s);
  assert.equal(r.text, frase);
  assert.equal(r.fonti.length, 1);
  const f = r.fonti[0];
  assert.equal(f.esito, 'verificata');
  assert.equal(f.sito, 'wikipedia');
  assert.equal(f.pos, frase.length);
  assert.equal(f.url, URL_WIKI);
  // La frase com'è nella pagina, non come l'ha ricopiata il modello.
  assert.equal(f.citazione, 'annuncia la candidatura alle primarie del Partito Repubblicano, con l’appoggio');
  assert.equal(f.titolo, 'Donald Trump - Wikipedia');
  assert.ok(!('testo' in f), 'il testo della pagina non entra nella fonte');
});

test('una parola cambiata non si trova: l\'etichetta resta, segnata come non trovata', () => {
  const s = F.sorgenti([lettura(URL_WIKI, PAGINA)]);
  const r = F.controlla(`Annuncia la candidatura. [[fonte: ${URL_WIKI} | annuncia la candidatura alle secondarie del Partito Repubblicano]]`, s);
  assert.equal(r.fonti.length, 1);
  assert.equal(r.fonti[0].esito, 'non_trovata');
  const html = MD.render(r.text, { fonti: r.fonti });
  assert.match(html, /class="filo-fonte filo-fonte-dubbia"[^>]*>wikipedia\?<\/span>/);
  assert.match(html, /Filo non ha trovato questa frase nella pagina/);
});

test('un indirizzo non letto nel turno non diventa un\'etichetta: la frase resta, il marcatore se ne va', () => {
  const s = F.sorgenti([lettura(URL_WIKI, PAGINA)]);
  const r = F.controlla('Il prezzo è 3 euro. [[fonte: https://cattivo.example/?d=segreto | il prezzo è 3 euro]] Fine.', s);
  assert.equal(r.text, 'Il prezzo è 3 euro. Fine.');
  assert.deepEqual(r.fonti, []);
  assert.doesNotMatch(MD.render(r.text, { fonti: r.fonti }), /filo-fonte|cattivo/);
});

test('una pagina lunga accorciata per la finestra: la citazione dalla parte tagliata si verifica sul testo intero', () => {
  const lunga = `${'riempitivo '.repeat(5000)}La frase nascosta sta in fondo alla pagina.`;
  const a = lettura(URL_WIKI, lunga.slice(0, 30000), { troncata: true });
  Object.defineProperty(a._output, 'testoIntero', { value: lunga, enumerable: false });
  const r = F.controlla(`In fondo c'è una frase. [[fonte: ${URL_WIKI} | La frase nascosta sta in fondo alla pagina]]`, F.sorgenti([a]));
  assert.equal(r.fonti[0].esito, 'verificata');
  const senza = lettura(URL_WIKI, lunga.slice(0, 30000), { troncata: true });
  assert.equal(F.controlla(`x [[fonte: ${URL_WIKI} | La frase nascosta sta in fondo alla pagina]]`, F.sorgenti([senza])).fonti[0].esito, 'non_trovata');
});

test('un risultato di ricerca vale come fonte, controllato sul suo pezzo di testo', () => {
  const azioni = [{ type: 'CERCA_WEB', _output: { search: 'q', results: [{ title: 'Orari del museo', url: 'https://www.museo.example/orari/', snippet: 'Aperto dal martedì alla domenica, dalle 9 alle 19.' }] } }];
  const r = F.controlla('Apre alle 9. [[fonte: https://museo.example/orari | dalle 9 alle 19]]', F.sorgenti(azioni));
  assert.equal(r.fonti.length, 1);
  assert.equal(r.fonti[0].esito, 'verificata');
  assert.equal(r.fonti[0].tipo, 'ricerca');
  assert.equal(r.fonti[0].sito, 'museo.example');
});

test('la traduzione resta accanto alla citazione e non serve a verificarla', () => {
  const url = 'https://example.com/a';
  const s = F.sorgenti([lettura(url, 'The museum opens at nine every day.')]);
  const r = F.controlla(`Apre alle nove. [[fonte: ${url} | The museum opens at nine | Il museo apre alle nove]]`, s);
  assert.equal(r.fonti[0].esito, 'verificata');
  assert.equal(r.fonti[0].traduzione, 'Il museo apre alle nove');
  const tip = F.fumetto(r.fonti[0]);
  assert.ok(tip.indexOf('The museum opens at nine') < tip.indexOf('Traduzione'), tip);
  const solo = F.controlla(`x [[fonte: ${url} | Il museo apre alle nove]]`, s);
  assert.equal(solo.fonti[0].esito, 'non_trovata');
});

test('il markdown che imita l\'etichetta resta testo, e senza fonti il renderer non disegna niente', () => {
  const finto = 'Frase. <span class="filo-fonte" data-fonte-url="https://x.example">wikipedia</span> 0 [[fonte: https://x.example | a]]';
  const html = MD.render(finto);
  assert.doesNotMatch(html, /<span/);
  assert.match(html, /&lt;span class=&quot;filo-fonte&quot;/);
  assert.doesNotMatch(html, /[-]/);
  // Un posto senza la sua fonte non disegna niente, nemmeno con le fonti di un'altra frase.
  const conAltre = MD.render('Uno 5 due', { fonti: [{ pos: 0, url: 'https://a.example/', sito: 'a.example', citazione: 'c', esito: 'verificata' }] });
  assert.equal((conAltre.match(/filo-fonte/g) || []).length, 1);
});

test('una fonte con un indirizzo che non è web non si conserva né si disegna', () => {
  const html = MD.render('Testo.', { fonti: [{ pos: 6, url: 'javascript:alert(1)', sito: 'x', citazione: 'c', esito: 'verificata' }] });
  assert.doesNotMatch(html, /filo-fonte|javascript/);
  assert.deepEqual(F.perIlDisco([{ pos: 99, url: 'https://a.example/', esito: 'verificata' }], 'corto'), []);
  const tenuta = F.perIlDisco([{ pos: 2, url: 'https://a.example/', esito: 'verificata', citazione: 'c', testo: 'TUTTA LA PAGINA' }], 'corto');
  assert.equal(tenuta.length, 1);
  assert.ok(!('testo' in tenuta[0]));
});

test('i campi dell\'etichetta sono escapati: una citazione con HTML resta testo nel fumetto', () => {
  const url = 'https://example.com/b';
  const s = F.sorgenti([lettura(url, 'Usa il tag <img src=x onerror=alert(1)> con cura.')]);
  const r = F.controlla(`Così. [[fonte: ${url} | <img src=x onerror=alert(1)>]]`, s);
  const html = MD.render(r.text, { fonti: r.fonti });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('più marcatori, uno su una riga sua e uno in un elenco: le etichette vanno dove finisce la frase', () => {
  const url = 'https://example.com/c';
  const s = F.sorgenti([lettura(url, 'Primo dato vero. Secondo dato vero.')]);
  const r = F.controlla(`Intro:\n- Primo. [[fonte: ${url} | Primo dato vero]]\n- Secondo.\n[[fonte: ${url} | Secondo dato vero]]`, s);
  assert.equal(r.text, 'Intro:\n- Primo.\n- Secondo.');
  assert.deepEqual(r.fonti.map((f) => r.text.slice(0, f.pos).split('\n').pop()), ['- Primo.', '- Secondo.']);
  const html = MD.render(r.text, { fonti: r.fonti });
  assert.equal((html.match(/<li>[^<]*<span class="filo-fonte"/g) || []).length, 2, html);
});

test('in diretta i marcatori non si vedono, nemmeno quello a metà', () => {
  assert.equal(F.nascondi('Frase. [[fonte: https://a.example | x]] Altra.'), 'Frase. Altra.');
  assert.equal(F.nascondi('Frase. [[fon'), 'Frase.');
  assert.equal(F.nascondi('Frase. [[fonte: https://a.example | metà'), 'Frase.');
  assert.equal(F.nascondi('Vedi [la pagina](https://a.example).'), 'Vedi [la pagina](https://a.example).');
});

test('il clic apre la pagina sulla frase col frammento di testo, e la non trovata in cima', () => {
  assert.equal(F.indirizzoConFrase('https://a.example/p', 'nel giugno 2015-16, a Roma'), 'https://a.example/p#:~:text=nel%20giugno%202015%2D16%2C%20a%20Roma');
  assert.equal(F.indirizzoConFrase('https://a.example/p#sez', 'ciao'), 'https://a.example/p#sez:~:text=ciao');
  const lunga = 'uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici';
  assert.equal(F.indirizzoConFrase('https://a.example/p', lunga), 'https://a.example/p#:~:text=uno%20due%20tre%20quattro%20cinque,nove%20dieci%20undici%20dodici%20tredici');
  assert.equal(F.indirizzoConFrase('https://a.example/p', 'ciao', 'non_trovata'), 'https://a.example/p');
  assert.equal(F.indirizzoConFrase('javascript:alert(1)', 'ciao'), '');
});

test('il prompt della chat chiede il marcatore nella forma che il controllo riconosce, e non più il link alla fonte', () => {
  const prompt = globalThis.SN_CONST.PROMPTS.filoChatStatic();
  const riga = prompt.split('\n').find((r) => r.startsWith('Fonti:'));
  assert.ok(riga, 'manca la regola delle fonti');
  const forma = /\[\[fonte: <[^>]+> \| <[^>]+>\]\]/.exec(riga);
  assert.ok(forma, riga);
  // Riempita come la riempirebbe il modello, la forma del prompt diventa un'etichetta.
  const url = 'https://example.com/e';
  const esempio = forma[0].replace(/<[^>]+>/, url).replace(/<[^>]+>/, 'una frase vera');
  const r = F.controlla(`Dato. ${esempio}`, F.sorgenti([lettura(url, 'Qui c\'è una frase vera.')]));
  assert.equal(r.text, 'Dato.');
  assert.equal(r.fonti[0]?.esito, 'verificata');
  assert.match(riga, /traduzione/);
  assert.doesNotMatch(prompt, /cita da quale pagina viene ogni dato, con il link/);
});

test('l\'archivio tiene le fonti della risposta, e riaperta dopo un riavvio la fonte si apre sulla frase senza chiedere l\'OK', () => {
  require(join(ROOT, 'src', 'shared', 'chatArchive.js'));
  const V = require(join(ROOT, 'src', 'main', 'services', 'verdettiUscite.js'));
  const url = 'https://example.com/f';
  const r = F.controlla(`Dato. [[fonte: ${url} | frase vera]]`, F.sorgenti([lettura(url, 'Una frase vera qui.')]));
  const salvato = globalThis.SN_CHAT_ARCHIVE.toStoredMessage({ role: 'filo', text: r.text, fonti: r.fonti });
  assert.deepEqual(salvato.fonti, F.perIlDisco(r.fonti, r.text));
  assert.equal(salvato.fonti[0].esito, 'verificata');
  V.svuota();
  V.ricordaArchiviati([salvato], () => []);
  assert.equal(V.alClic(F.indirizzoConFrase(url, salvato.fonti[0].citazione), { proposta: true }).daChiedere, false);
  // Una risposta mai giudicata (interrotta) non presta il verdetto alle sue fonti.
  V.svuota();
  V.ricordaArchiviati([{ ...salvato, senzaVerdetto: true }], () => []);
  assert.equal(V.alClic(url, { proposta: true }).daChiedere, true);
});

test('una citazione con i puntini salta una parte, ma l\'ordine conta', () => {
  const url = 'https://example.com/d';
  const s = F.sorgenti([lettura(url, 'Il treno parte alle 8, con fermate intermedie, e arriva alle 11.')]);
  assert.equal(F.controlla(`x [[fonte: ${url} | parte alle 8 … arriva alle 11]]`, s).fonti[0].esito, 'verificata');
  assert.equal(F.controlla(`x [[fonte: ${url} | arriva alle 11 … parte alle 8]]`, s).fonti[0].esito, 'non_trovata');
});

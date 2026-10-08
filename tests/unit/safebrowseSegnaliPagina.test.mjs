// #814 — i segnali che non dipendono da chi è il sito: programma partito da solo, doppia estensione, modulo che manda in
// chiaro. Cambiano l'avviso anche sui siti in whitelist; l'origine del link arriva al giudizio AI.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');
const llm = require('../../src/main/services/safebrowse/llm.js');

beforeEach(() => {
  for (const c of Object.values(SB._caches)) c.m.clear();
  SB.setProviders({ gsb: null, rdap: null, ct: null, llm: null, sandbox: null });
});

const giudica = (url, ctx = {}, rete = {}) => SB.evaluate(url, ctx, rete);

test('un programma partito da solo: sospetto, e pericoloso con un dominio giovane o un certificato cattivo', () => {
  const solo = giudica('https://scarica-subito.it/', { autoDownload: 'setup.exe' });
  assert.equal(solo.level, 'sospetto');
  assert.equal(solo.message.title, 'Scaricamento partito da solo');
  assert.match(solo.message.body, /ha avviato da sola lo scaricamento di un programma \(«setup\.exe»\)/);

  const giovane = giudica('https://scarica-subito.it/', { autoDownload: 'setup.exe' }, { ageDays: 3 });
  assert.equal(giovane.level, 'pericoloso');
  assert.match(giovane.message.body, /registrato 3 giorni fa/);

  assert.equal(giudica('https://scarica-subito.it/', { autoDownload: 'setup.exe' }, { cert: { status: 'expired' } }).level, 'pericoloso');
  assert.equal(giudica('https://scarica-subito.it/', {}).level, 'safe');
});

test('doppia estensione nell\'indirizzo aperto o nel file che la pagina fa scaricare', () => {
  const nell = giudica('https://documenti-fattura.it/allegati/fattura.pdf.exe');
  assert.equal(nell.level, 'sospetto');
  assert.match(nell.message.body, /finisce con «fattura\.pdf\.exe», che sembra un documento ma è un programma/);
  // Scritta coi caratteri cifrati è lo stesso indirizzo.
  assert.equal(giudica('https://documenti-fattura.it/fattura.pdf%2Eexe').level, 'sospetto');

  const scaricato = giudica('https://archivio-fatture.it/', { downloadName: 'fattura.pdf.exe' });
  assert.equal(scaricato.level, 'sospetto');
  assert.match(scaricato.message.body, /ti fa scaricare «fattura\.pdf\.exe»/);

  assert.equal(giudica('https://archivio-fatture.it/', { downloadName: 'fattura.pdf.exe' }, { ageDays: 2 }).level, 'pericoloso');
  assert.equal(giudica('https://archivio-fatture.it/', { downloadName: 'foto.jpg.scr' }, { cert: { status: 'self_signed' } }).level, 'pericoloso');
  // Gli spazi che spingono «.exe» fuori dalla vista, nel nome e nell'indirizzo.
  assert.equal(giudica('https://archivio-fatture.it/', { downloadName: 'fattura.pdf        .exe' }).level, 'sospetto');
  assert.equal(giudica('https://archivio-fatture.it/', { downloadName: 'fattura.pdf  .exe' }).level, 'sospetto');
  assert.equal(giudica('https://documenti-fattura.it/fattura.pdf%20%20%20%20.exe').level, 'sospetto');

  // Il travestimento sceglie il tipo che ispira fiducia: film, immagini, documenti meno comuni, archivi; e due punti di fila.
  for (const nome of ['Film.2024.1080p.mkv.exe', 'documento.odt.exe', 'contratto.rtf.exe', 'foto.webp.scr', 'canzone.wav.exe',
    'archivio.7z.exe', 'video.mov.exe', 'foto.heic.exe', 'scansione.tiff.exe', 'fattura.pdf..exe']) {
    assert.equal(giudica('https://archivio-fatture.it/', { downloadName: nome }).level, 'sospetto', nome);
  }

  // Un programma con un nome solo, o coi numeri di versione, o un file con due punti che non finge niente, non è un
  // travestimento.
  for (const nome of ['setup.exe', 'jquery.min.js', 'archivio.tar.gz', 'relazione.pdf', 'node-v20.10.0.msi',
    'Firefox Setup 120.0.exe', 'python-3.12.0-amd64.exe', 'Microsoft.Teams.exe']) {
    assert.equal(giudica('https://archivio-fatture.it/', { downloadName: nome }).level, 'safe', nome);
  }
});

test('stesso file partito da solo e travestito: una frase sola, col nome', () => {
  const v = giudica('https://scarica-subito.it/', { autoDownload: 'fattura.pdf.exe', downloadName: 'fattura.pdf.exe' });
  assert.equal(v.level, 'sospetto');
  assert.match(v.message.body, /ha avviato da sola lo scaricamento di «fattura\.pdf\.exe», che sembra un documento ma è un programma\.$/);
});

test('modulo che manda password o carta in chiaro da una pagina https: sospetto col messaggio sui dati', () => {
  const v = giudica('https://banca-esempio.it/accesso', { hasPassword: true, insecureForm: true });
  assert.equal(v.level, 'sospetto');
  assert.equal(v.message.title, 'Dati in chiaro');
  assert.match(v.message.body, /I dati che scrivi qui viaggiano in chiaro/);
});

test('la whitelist certifica chi è il sito, non che sia sicuro: i tre segnali valgono anche lì', () => {
  assert.equal(giudica('https://www.amazon.it/').level, 'safe');
  const casi = [
    [{ autoDownload: 'setup.exe' }, /ha avviato da sola lo scaricamento/],
    [{ downloadName: 'fattura.pdf.exe' }, /ti fa scaricare «fattura\.pdf\.exe»/],
    [{ hasPassword: true, insecureForm: true }, /viaggiano in chiaro/],
  ];
  for (const [ctx, frase] of casi) {
    const v = giudica('https://www.amazon.it/accesso', ctx);
    assert.equal(v.level, 'sospetto', JSON.stringify(ctx));
    assert.match(v.message.body, frase);
    assert.equal(v.needsLlm, false);
  }
  assert.equal(giudica('https://www.amazon.it/x/fattura.pdf.exe').level, 'sospetto');
  assert.equal(giudica('https://www.amazon.it/', { autoDownload: 'setup.exe' }, { cert: { status: 'expired' } }).level, 'pericoloso');
});

test('un nome di file lunghissimo o con caratteri che ne cambiano la lettura si mostra leggibile', () => {
  const lungo = `${'a'.repeat(300)}.pdf.exe`;
  const v = giudica('https://scarica-subito.it/', { autoDownload: lungo });
  assert.ok(v.message.body.length < 260, v.message.body);
  assert.match(v.message.body, /…a+\.pdf\.exe»/);
  const rovescio = giudica('https://scarica-subito.it/', { autoDownload: 'fattura‮fdp.exe' });
  assert.doesNotMatch(rovescio.message.body, /‮/);
});

test('origine del link: scritto, Filo, link cliccato o reindirizzamento, con il dominio di partenza', () => {
  const qui = 'https://area-clienti.it/accesso';
  assert.equal(SB.origineLink(null, qui), null);
  assert.equal(SB.origineLink({ tipo: 'scritto' }, qui), 'indirizzo scritto a mano');
  assert.equal(SB.origineLink({ tipo: 'filo' }, qui), 'pagina aperta da Filo');
  assert.equal(SB.origineLink({ tipo: 'link', da: 'https://www.notizie-oggi.it/articolo?id=7', gesto: true }, qui),
    'link cliccato su un altro sito (notizie-oggi.it)');
  assert.equal(SB.origineLink({ tipo: 'link', da: 'https://www.area-clienti.it/', gesto: true }, qui), 'link cliccato sullo stesso sito');
  assert.equal(SB.origineLink({ tipo: 'link', da: 'https://rimbalzo.net/x', gesto: false }, qui),
    'reindirizzamento automatico da un altro sito (rimbalzo.net)');
  assert.equal(SB.origineLink({ tipo: 'link', da: 'about:blank', gesto: true }, qui), null);
});

test('l\'origine del link arriva nei metadati del giudizio AI, e nel testo che il modello legge', async () => {
  const visti = [];
  SB.setProviders({ llm: async (meta) => { visti.push(meta); return { suspicious: false, reason: null }; } });
  const url = 'http://area-clienti-esempio.it/accesso';
  const linkOrigin = SB.origineLink({ tipo: 'link', da: 'https://partenza-notizie.it/', gesto: true }, url);
  SB.analyze(url, { hasPassword: true, linkOrigin }, () => {});
  for (let i = 0; i < 300 && !visti.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(visti[0].linkOrigin, 'link cliccato su un altro sito (partenza-notizie.it)');
  assert.match(llm.buildUserMessage(visti[0]), /^origine_link: link cliccato su un altro sito \(partenza-notizie\.it\)$/m);
});

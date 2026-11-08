// #1488 — «Salva video come…» su un video in streaming, dal programma alla riga dei Download, con un yt-dlp finto
// (tests/helpers/ytdlpFinto.mjs) e il registro vero dei download. Il cammino dal tasto destro sta in
// tests/salva-video-streaming.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'i18n.js'));
// Come nell'app: senza l'elenco dei tipi eseguibili ogni nome conterebbe come un programma da confermare.
require(join(ROOT, 'src', 'shared', 'eseguibili.js'));
const DL = require(join(ROOT, 'src', 'main', 'services', 'downloads.js'));
const SV = require(join(ROOT, 'src', 'main', 'services', 'salvaVideoStreaming.js'));

const URL_SEGNALATO = 'https://www.youtube.com/watch?v=AOi9E5_T8Xc&list=RDAOi9E5_T8Xc&start_radio=1';
const base = cartellaTemporanea('filo-streaming-');
const scaricati = join(base, 'Download');
const registro = join(base, 'registro.jsonl');
const caso = join(base, 'caso.json');
mkdirSync(scaricati, { recursive: true });
process.env.FILO_DOWNLOAD_DIR = scaricati;
process.env.FILO_YTDLP_COMANDO = JSON.stringify([process.execPath, join(ROOT, 'tests', 'helpers', 'ytdlpFinto.mjs')]);
process.env.FILO_YTDLP_FINTO_REGISTRO = registro;
process.env.FILO_YTDLP_FINTO_CASO = caso;
process.on('exit', () => { try { togliCartella(base); } catch (_) {} });

const ilCaso = (c) => { writeFileSync(caso, JSON.stringify(c)); try { rmSync(registro, { force: true }); } catch (_) {} };
const voce = (id) => DL.list().find((r) => r.id === id);
const ultima = () => DL.list().filter((r) => r.via === 'streaming').sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
const sposta = async (da, a) => renameSync(da, a);
const dentro = (nome) => ({ filePath: join(scaricati, nome) });
const lavoriRimasti = () => readdirSync(scaricati).filter((n) => n.startsWith('.filo-video-'));

// Le note della riga si leggono mentre il salvataggio va, come le leggerebbe la pagina Download.
function osserva() {
  const viste = new Set();
  const percentuali = [];
  const t = setInterval(() => {
    for (const r of DL.list()) {
      if (r.via !== 'streaming' || r.state !== 'progressing') continue;
      if (r.nota) viste.add(r.nota);
      if (r.totalBytes) percentuali.push(Math.round((r.receivedBytes / r.totalBytes) * 100));
    }
  }, 10);
  return { viste, percentuali, ferma: () => clearInterval(t) };
}

test('il video della segnalazione arriva col suo titolo, in MP4, e la riga dice cosa sta facendo', async () => {
  ilCaso({ titolo: 'Canzone di prova', pausaMs: 40 });
  const o = osserva();
  let chiesto = '';
  const r = await SV.salva({ url: URL_SEGNALATO, titolo: '(2) Titolo della pagina - YouTube', scegli: async (n) => { chiesto = n; return dentro(n); }, sposta });
  o.ferma();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(chiesto, 'Canzone di prova.mp4', 'il nome viene dal titolo del video');
  assert.equal(statSync(join(scaricati, 'Canzone di prova.mp4')).size, 360 * 1024);
  const v = ultima();
  assert.equal(v.state, 'completed');
  assert.equal(v.filename, 'Canzone di prova.mp4');
  assert.equal(v.nota, '');
  assert.ok(o.viste.has('Leggo il video'), [...o.viste].join(' | '));
  assert.ok(o.viste.has('Unisco video e audio'), [...o.viste].join(' | '));
  assert.ok(o.percentuali.some((p) => p > 0 && p < 100), 'una percentuale vera, sul totale di video e audio');
  assert.ok(o.percentuali.every((p, i) => i === 0 || p >= o.percentuali[i - 1]), `la barra non torna indietro: ${o.percentuali.join(',')}`);
  assert.deepEqual(lavoriRimasti(), [], 'la cartella di lavoro se ne va');

  const { argv, runAsNode } = JSON.parse(readFileSync(registro, 'utf8').trim().split('\n')[0]);
  assert.deepEqual(argv.slice(-2), ['--', URL_SEGNALATO]);
  assert.ok(argv.includes('--ignore-config') && argv.includes('--no-playlist'));
  assert.ok(!argv.some((a) => /cookie/i.test(a)), 'nessun cookie dell\'account al programma');
  assert.equal(runAsNode, '1');
});

test('un video con limite d\'età non chiede dove salvare e dice perché, anche sulla riga', async () => {
  ilCaso({ errore: 'Sign in to confirm your age. This video may be inappropriate for some users. Use --cookies-from-browser or --cookies for the authentication.' });
  let dialogo = false;
  const r = await SV.salva({ url: URL_SEGNALATO, titolo: 'X', scegli: async (n) => { dialogo = true; return dentro(n); }, sposta });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'eta');
  assert.match(r.frase, /limite d'età/);
  assert.match(r.frase, /non usa il tuo account/);
  assert.equal(dialogo, false);
  const v = ultima();
  assert.equal(v.state, 'interrupted');
  assert.equal(v.nota, r.frase);
  assert.deepEqual(lavoriRimasti(), []);
});

test('una diretta lo dice invece di scaricare per ore', async () => {
  ilCaso({ diretta: true });
  const r = await SV.salva({ url: URL_SEGNALATO, titolo: 'X', scegli: async (n) => dentro(n), sposta });
  assert.equal(r.motivo, 'diretta');
});

test('«Annulla» ferma il programma e non lascia niente sul disco', async () => {
  ilCaso({ titolo: 'Lungo', pausaMs: 150, passi: 200 });
  const corsa = SV.salva({ url: URL_SEGNALATO, titolo: 'Lungo', scegli: async () => new Promise(() => {}), sposta });
  let id = '';
  for (let i = 0; i < 200 && !id; i++) {
    await new Promise((r) => setTimeout(r, 25));
    const v = ultima();
    if (v && v.state === 'progressing' && v.receivedBytes > 0) id = v.id;
  }
  assert.ok(id, 'il salvataggio è partito');
  const { pid } = JSON.parse(readFileSync(registro, 'utf8').trim().split('\n')[0]);
  DL.cancel(id);
  const r = await corsa;
  assert.equal(r.cancelled, true);
  assert.equal(voce(id).state, 'cancelled');
  let vivo = true;
  for (let i = 0; i < 40 && vivo; i++) {
    try { process.kill(pid, 0); await new Promise((x) => setTimeout(x, 50)); } catch (_) { vivo = false; }
  }
  assert.equal(vivo, false, 'il programma non continua in sottofondo');
  assert.deepEqual(lavoriRimasti(), []);
  assert.ok(!existsSync(join(scaricati, 'Lungo.mp4')));
});

test('chi annulla il dialogo non riceve il file, e il programma si ferma', async () => {
  ilCaso({ titolo: 'Annullato', pausaMs: 30 });
  const r = await SV.salva({ url: URL_SEGNALATO, titolo: 'X', scegli: async () => ({ cancelled: true }), sposta });
  assert.equal(r.cancelled, true);
  assert.equal(ultima().state, 'cancelled');
  assert.ok(!existsSync(join(scaricati, 'Annullato.mp4')));
  assert.deepEqual(lavoriRimasti(), []);
});

test('l\'audio arriva da solo, e l\'estensione segue il file vero anche se il nome scelto dice altro', async () => {
  ilCaso({ titolo: 'Solo voce', pausaMs: 10 });
  const r = await SV.salva({ url: URL_SEGNALATO, titolo: 'X', audio: true, scegli: async () => dentro('scelto.mp4'), sposta });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.filename, 'scelto.m4a');
  assert.equal(statSync(join(scaricati, 'scelto.m4a')).size, 60 * 1024);
});

test('«Riprova» su una riga fallita rifà il salvataggio dalla stessa pagina, nella stessa riga', async () => {
  ilCaso({ errore: 'Video unavailable' });
  await SV.salva({ url: URL_SEGNALATO, titolo: 'Da riprovare', scegli: async (n) => dentro(n), sposta });
  const fallita = ultima();
  assert.equal(fallita.state, 'interrupted');
  const chiamate = [];
  DL.quandoRiprovaStreaming((x) => chiamate.push(x));
  try {
    const r = DL.riprova(fallita.id);
    assert.equal(r.ok, true);
    assert.deepEqual(chiamate, [{ id: fallita.id, url: URL_SEGNALATO, filename: 'Da riprovare.mp4', scope: '', sessione: null, paese: null }]);
    ilCaso({ titolo: 'Da riprovare', pausaMs: 5 });
    const ok = await SV.salva({ url: URL_SEGNALATO, titolo: 'Da riprovare', riusa: fallita.id, scegli: async (n) => dentro(n), sposta });
    assert.equal(ok.ok, true);
    assert.equal(voce(fallita.id).state, 'completed', 'la stessa riga, ora riuscita');
    // Da una riga riuscita «Ri-scarica» ne apre una nuova e lascia com'è quella vecchia.
    chiamate.length = 0;
    DL.riprova(fallita.id);
    assert.equal(chiamate[0].id, '');
  } finally {
    DL.quandoRiprovaStreaming(null);
  }
});

test('il titolo del sito diventa un nome di file valido su ogni sistema', () => {
  assert.equal(SV.nomeSicuro('a/b:c?<>|"*\\d', '.mp4'), 'a b c d.mp4');
  assert.equal(SV.nomeSicuro('  ..nascosto.. ', '.mp4'), 'nascosto.mp4');
  assert.equal(SV.nomeSicuro('CON', '.mp4'), 'video CON.mp4');
  assert.equal(SV.nomeSicuro('', '.mp4'), 'video.mp4');
  assert.equal(SV.nomeSicuro('🎵 canzone 🎵', '.m4a'), '🎵 canzone 🎵.m4a');
  const lungo = SV.nomeSicuro('日本語'.repeat(60), '.mp4');
  assert.ok(Buffer.byteLength(lungo, 'utf8') <= 255, 'sta nel limite di Linux e macOS');
  assert.ok(lungo.endsWith('語.mp4'), 'nessuna lettera spezzata a metà');
});

test('un nome che il sito cambia a metà non lascia la riga col nome della pagina', async () => {
  ilCaso({ titolo: 'Titolo vero dal sito', pausaMs: 30 });
  const nomi = new Set();
  const t = setInterval(() => { const v = ultima(); if (v && v.state === 'progressing') nomi.add(v.filename); }, 5);
  const r = await SV.salva({ url: URL_SEGNALATO, titolo: 'Titolo della pagina - YouTube', scegli: async (n) => dentro(n), sposta });
  clearInterval(t);
  assert.equal(r.filename, 'Titolo vero dal sito.mp4');
  assert.ok(nomi.has('Titolo vero dal sito.mp4'), 'la riga prende il titolo vero mentre scende');
});

test('al programma va l\'indirizzo del video cliccato se è dello stesso sito della pagina, altrimenti la pagina', () => {
  const da = SV.indirizzoDaSalvare;
  assert.equal(da('https://www.youtube.com/@canale', '/watch?v=TRAILER'), 'https://www.youtube.com/watch?v=TRAILER');
  assert.equal(da('https://www.youtube.com/', 'https://m.youtube.com/watch?v=X'), 'https://m.youtube.com/watch?v=X');
  assert.equal(da('https://x.com/home', 'https://x.com/utente/status/123'), 'https://x.com/utente/status/123');
  assert.equal(da('https://www.youtube.com/', 'https://altro.test/v'), 'https://www.youtube.com/', 'un altro sito no');
  assert.equal(da('https://www.bbc.co.uk/news', 'https://www.altro.co.uk/v'), 'https://www.bbc.co.uk/news', '«co.uk» non è un sito');
  assert.equal(da('https://x.com/home', 'javascript:alert(1)'), 'https://x.com/home');
  assert.equal(da('https://x.com/home', 'file:///etc/passwd'), 'https://x.com/home');
  assert.equal(da('https://www.youtube.com/watch?v=A#t=3', ''), 'https://www.youtube.com/watch?v=A#t=3');
});

test('mentre lavora la cartella di lavoro è nell\'elenco su disco, e quelle rimaste da un\'uscita brusca se ne vanno all\'avvio', async () => {
  const dati = join(base, 'dati');
  const elenco = join(dati, 'programmi-video', 'lavori.json');
  process.env.FILO_USER_DATA = dati;
  try {
    ilCaso({ titolo: 'Video in corso', pausaMs: 40 });
    const visti = new Set();
    const t = setInterval(() => { try { for (const d of JSON.parse(readFileSync(elenco, 'utf8'))) visti.add(d); } catch (_) {} }, 5);
    const r = await SV.salva({ url: URL_SEGNALATO, titolo: 'X', scegli: async (n) => dentro(n), sposta });
    clearInterval(t);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok([...visti].some((d) => d.startsWith(join(scaricati, '.filo-video-'))), 'la cartella è stata nell\'elenco');
    assert.deepEqual(JSON.parse(readFileSync(elenco, 'utf8')), [], 'finito il salvataggio l\'elenco è vuoto');

    // Un'uscita che non ha pulito: la cartella resta, e l'elenco la ricorda.
    const rimasta = join(scaricati, '.filo-video-AbC123');
    mkdirSync(rimasta, { recursive: true });
    writeFileSync(join(rimasta, 'video.f137.mp4.part'), 'mezzo video');
    const estranea = join(scaricati, 'Le mie foto');
    mkdirSync(estranea, { recursive: true });
    writeFileSync(elenco, JSON.stringify([rimasta, estranea, 'relativo/.filo-video-x']));
    SV.pulisciAvanzi();
    assert.equal(existsSync(rimasta), false, 'la cartella di lavoro rimasta se ne va');
    assert.equal(existsSync(estranea), true, 'un nome che non è una cartella di lavoro di Filo non si tocca');
    assert.deepEqual(JSON.parse(readFileSync(elenco, 'utf8')), []);
  } finally {
    delete process.env.FILO_USER_DATA;
  }
});

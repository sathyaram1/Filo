// Un yt-dlp finto che scrive l'avanzamento come il vero (2026.10.26): mentre scende un pezzo di un video a pezzi
// separati, il campo dei formati chiesti vale NA, perché il vero lo toglie dal pezzo. Su un indirizzo che non è di un
// video (un canale, una ricerca) scorre l'elenco come il vero, e si ferma dopo il primo solo con --max-downloads 1,
// -I 1 / --playlist-items 1 o --playlist-end 1. Caso in FILO_YTDLP_FINTO_CASO, eventi in FILO_YTDLP_FINTO_REGISTRO.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const leggi = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return {}; } };
const caso = (process.env.FILO_YTDLP_FINTO_CASO && leggi(process.env.FILO_YTDLP_FINTO_CASO)) || {};
const registra = (o) => { if (process.env.FILO_YTDLP_FINTO_REGISTRO) appendFileSync(process.env.FILO_YTDLP_FINTO_REGISTRO, `${JSON.stringify(o)}\n`); };
registra({ argv, pid: process.pid });

const valore = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : ''; };
const modelli = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--progress-template') modelli.push(argv[i + 1]);
const modello = (tipo) => (modelli.find((m) => m.startsWith(`${tipo}:`)) || '').slice(tipo.length + 1);
const riempi = (m, campi) => m.replace(/%\(([^)]+)\)([sj])/g, (_, k, conv) => {
  if (campi[k] === undefined) return 'NA';
  return conv === 'j' ? JSON.stringify(campi[k]) : String(campi[k]);
});
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
const uscita = valore('-o');
const url = argv[argv.length - 1];
const pausa = Number(caso.pausaMs) || 60;
const passi = Number(caso.passi) || 8;

// Giro 2: come il vero, `--print-to-file before_dl:` scrive l'elenco dei pezzi; nel `.:.` il vero salta i valori
// che mancano, quindi la lista dei pesi esatti si accorcia (provato su yt-dlp 2026.10.26). `caso.pesi`:
// { '137': { esatto, circa }, '140': {…} }, `caso.stima`: pezzi a frammenti, col solo peso stimato che cambia.
const PEZZI = [['137', 300 * 1024], ['140', 60 * 1024]];
const pesoDi = (f) => (caso.pesi && caso.pesi[f]) || { esatto: PEZZI.find((p) => p[0] === f)[1] };
function stampaPezzi() {
  const i = argv.indexOf('--print-to-file');
  if (i < 0 || !String(argv[i + 1]).startsWith('before_dl:')) return;
  const lista = (k) => JSON.stringify(PEZZI.map(([f]) => pesoDi(f)[k]).filter((v) => v !== undefined));
  const riga = argv[i + 1].slice('before_dl:'.length)
    .replace('%(requested_formats.:.format_id)j', JSON.stringify(PEZZI.map(([f]) => f)))
    .replace('%(requested_formats.:.filesize)j', lista('esatto'))
    .replace('%(requested_formats.:.filesize_approx)j', lista('circa'));
  const file = argv[i + 2].replace(/%%/g, '%');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${riga}\n`);
}

async function pezzo(formato, peso, titolo) {
  for (let k = 1; k <= passi; k++) {
    const scaricati = Math.round((peso * k) / passi);
    // A frammenti il vero stima il totale dai frammenti scesi: all'inizio è piccolo, poi oscilla.
    const stima = caso.stima ? Math.round(scaricati * (k % 2 ? 1.6 : 0.9) + peso * (k / passi) * 0.2) : undefined;
    process.stdout.write(`${riempi(modello('download'), {
      'progress.status': 'downloading', 'progress.downloaded_bytes': scaricati,
      'progress.total_bytes': caso.stima ? undefined : peso, 'progress.total_bytes_estimate': stima,
      'info.format_id': formato, 'info.title': titolo,
    })}\n`);
    await attesa(pausa);
  }
  process.stdout.write(`${riempi(modello('download'), {
    'progress.status': 'finished', 'progress.downloaded_bytes': peso, 'progress.total_bytes': peso,
    'info.format_id': formato, 'info.title': titolo,
  })}\n`);
}

async function unVideo(titolo) {
  const file = uscita.replace('%(ext)s', 'mp4');
  if (existsSync(file)) { process.stdout.write(`[download] ${file} has already been downloaded\n`); return false; }
  stampaPezzi();
  await pezzo('137', 300 * 1024, titolo);
  await attesa(Number(caso.pausaFraPezzi) || 0);
  await pezzo('140', 60 * 1024, titolo);
  process.stdout.write(`${riempi(modello('postprocess'), { 'progress.status': 'started', 'progress.postprocessor': 'Merger' })}\n`);
  await attesa(pausa);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.alloc(360 * 1024, 0x42));
  return true;
}

const unoSolo = valore('--max-downloads') === '1' || valore('-I') === '1' || valore('--playlist-items') === '1'
  || valore('--playlist-end') === '1';
if (/[?&]v=/.test(url) || !caso.lista) {
  await unVideo(caso.titolo || 'Canzone di prova');
} else {
  for (let i = 1; i <= Number(caso.lista); i++) {
    registra({ voce: i });
    process.stdout.write(`[download] Downloading item ${i} of ${caso.lista}\n`);
    await unVideo(`Video ${i} del canale`);
    if (unoSolo) break;
    await attesa(pausa);
  }
}
process.exit(0);

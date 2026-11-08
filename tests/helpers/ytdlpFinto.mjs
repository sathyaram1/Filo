// Un yt-dlp finto per le prove del salvataggio dei video in streaming (#1488): legge gli argomenti e parla come il vero
// (2026.10.26), che nelle righe d'avanzamento di un pezzo non mette l'elenco dei pezzi ma lo scrive prima con
// --print-to-file. Caso in FILO_YTDLP_FINTO_CASO; argomenti ed elenchi letti in FILO_YTDLP_FINTO_REGISTRO.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const leggi = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return {}; } };
const caso = (process.env.FILO_YTDLP_FINTO_CASO && leggi(process.env.FILO_YTDLP_FINTO_CASO)) || {};
const registra = (o) => { if (process.env.FILO_YTDLP_FINTO_REGISTRO) appendFileSync(process.env.FILO_YTDLP_FINTO_REGISTRO, `${JSON.stringify(o)}\n`); };
const proxy = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(https?|all|no)_proxy$/i.test(k)));
registra({ argv, pid: process.pid, runAsNode: process.env.ELECTRON_RUN_AS_NODE || '', proxy });

const valore = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : ''; };
const modelli = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--progress-template') modelli.push(argv[i + 1]);
const modello = (tipo) => (modelli.find((m) => m.startsWith(`${tipo}:`)) || '').slice(tipo.length + 1);
const riempi = (m, campi) => m.replace(/%\(([^)]+)\)([sj])/g, (_, k, conv) => {
  if (campi[k] === undefined) return 'NA';
  return conv === 'j' ? JSON.stringify(campi[k]) : String(campi[k]);
});
const percorso = (p) => p.replace(/%%/g, '%');
const uscita = valore('-o');
const url = argv[argv.length - 1];
const titolo = caso.titolo || 'Canzone di prova';
const video = 300 * 1024;
const audio = 60 * 1024;
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
const pausa = Number(caso.pausaMs) || 60;
const passi = Number(caso.passi) || 8;
const audioSolo = argv.includes('ba[ext=m4a]/ba/b');

// Prima di scaricare, l'elenco dei pezzi col modello `before_dl:` nel file indicato.
function stampaPezzi(campi) {
  const i = argv.indexOf('--print-to-file');
  if (i < 0 || !argv[i + 1].startsWith('before_dl:')) return;
  const file = percorso(argv[i + 2]);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${riempi(argv[i + 1].slice('before_dl:'.length), campi)}\n`);
}

async function pezzo(formato, peso, nome) {
  for (let k = 1; k <= passi; k++) {
    process.stdout.write(`${riempi(modello('download'), {
      'progress.status': 'downloading', 'progress.downloaded_bytes': Math.round((peso * k) / passi),
      'progress.total_bytes': caso.senzaPeso ? undefined : peso, 'info.format_id': formato, 'info.title': nome,
    })}\n`);
    await attesa(pausa);
  }
  process.stdout.write(`${riempi(modello('download'), {
    'progress.status': 'finished', 'progress.downloaded_bytes': peso, 'progress.total_bytes': peso,
    'info.format_id': formato, 'info.title': nome,
  })}\n`);
}

async function unVideo(nome) {
  const file = percorso(uscita).replace('%(ext)s', audioSolo ? 'm4a' : 'mp4');
  if (existsSync(file)) { process.stdout.write(`[download] ${file} has already been downloaded\n`); return; }
  if (audioSolo) {
    stampaPezzi({});
    await pezzo('140', audio, nome);
  } else {
    stampaPezzi({
      'requested_formats.:.format_id': ['137', '140'],
      'requested_formats.:.filesize': caso.senzaPeso ? undefined : [video, audio],
    });
    // Come il vero: un pezzo per formato, uno dopo l'altro, poi l'unione.
    await pezzo('137', video, nome);
    await attesa(Number(caso.pausaFraPezzi) || 0);
    await pezzo('140', audio, nome);
    process.stdout.write(`${riempi(modello('postprocess'), { 'progress.status': 'started', 'progress.postprocessor': 'Merger' })}\n`);
    await attesa(pausa);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.alloc(audioSolo ? audio : video + audio, 0x42));
}

if (caso.errore) {
  await attesa(200);
  process.stderr.write(`ERROR: [youtube] AOi9E5_T8Xc: ${caso.errore}\n`);
  process.exit(1);
}
if (caso.diretta) {
  process.stdout.write('[download] AOi9E5_T8Xc: Canzone di prova does not pass filter (!is_live), skipping ..\n');
  process.exit(0);
}

// Un indirizzo che non è di un video (un canale, una ricerca) è un elenco: il vero lo scorre tutto, e lo ferma alla
// prima voce solo --break-match-filters sul playlist_id.
if (caso.lista && !/[?&]v=|\/status\//.test(url)) {
  const ferma = argv.some((a, i) => (a === '--break-match-filters' || a === '--break-match-filter') && /playlist_id/.test(argv[i + 1] || ''));
  for (let i = 1; i <= Number(caso.lista); i++) {
    registra({ voce: i });
    if (ferma) {
      process.stdout.write('[download] entry does not pass filter (!playlist_id), skipping ..\n');
      process.stdout.write('[info] Encountered a video that did not match filter, stopping due to --break-match-filter\n');
      process.stderr.write('Aborting remaining downloads\n');
      process.exit(101);
    }
    process.stdout.write(`[download] Downloading item ${i} of ${caso.lista}\n`);
    await unVideo(`Video ${i} del canale`);
    await attesa(pausa);
  }
  process.exit(0);
}

await unVideo(titolo);
registra({ salvato: url });
process.exit(0);

// Un yt-dlp finto per le prove del salvataggio dei video in streaming (#1488): legge gli argomenti come il vero,
// scrive le righe d'avanzamento coi modelli che Filo gli passa e lascia «video.<ext>» nella cartella di -o.
// Il caso lo sceglie il file JSON in FILO_YTDLP_FINTO_CASO; gli argomenti ricevuti finiscono in FILO_YTDLP_FINTO_REGISTRO.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const leggi = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return {}; } };
const caso = (process.env.FILO_YTDLP_FINTO_CASO && leggi(process.env.FILO_YTDLP_FINTO_CASO)) || {};
if (process.env.FILO_YTDLP_FINTO_REGISTRO) {
  appendFileSync(process.env.FILO_YTDLP_FINTO_REGISTRO, `${JSON.stringify({ argv, pid: process.pid, runAsNode: process.env.ELECTRON_RUN_AS_NODE || '' })}\n`);
}

const valore = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : ''; };
const modelli = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--progress-template') modelli.push(argv[i + 1]);
const modello = (tipo) => (modelli.find((m) => m.startsWith(`${tipo}:`)) || '').slice(tipo.length + 1);
const riempi = (m, campi) => m.replace(/%\(([^)]+)\)([sj])/g, (_, k, conv) => {
  if (campi[k] === undefined) return 'NA';
  return conv === 'j' ? JSON.stringify(campi[k]) : String(campi[k]);
});
const uscita = valore('-o');
const titolo = caso.titolo || 'Canzone di prova';
const video = 300 * 1024;
const audio = 60 * 1024;
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

async function pezzo(formato, peso, passi, pausa, tutti) {
  for (let k = 1; k <= passi; k++) {
    const campi = {
      'progress.status': 'downloading', 'progress.downloaded_bytes': Math.round((peso * k) / passi),
      'progress.total_bytes': caso.senzaPeso ? undefined : peso, 'info.format_id': formato, 'info.title': titolo,
      'info.requested_formats.:.format_id': tutti, 'info.requested_formats.:.filesize': caso.senzaPeso || !tutti ? undefined : [video, audio],
    };
    process.stdout.write(`${riempi(modello('download'), campi)}\n`);
    await attesa(pausa);
  }
  process.stdout.write(`${riempi(modello('download'), {
    'progress.status': 'finished', 'progress.downloaded_bytes': peso, 'progress.total_bytes': peso,
    'info.format_id': formato, 'info.title': titolo, 'info.requested_formats.:.format_id': tutti,
  })}\n`);
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

const pausa = Number(caso.pausaMs) || 60;
const passi = Number(caso.passi) || 8;
const audioSolo = argv.includes('ba[ext=m4a]/ba/b');
if (audioSolo) {
  await pezzo('140', audio, passi, pausa);
} else {
  // Come il vero: un pezzo per formato, uno dopo l'altro, poi l'unione.
  await pezzo('137', video, passi, pausa, ['137', '140']);
  await pezzo('140', audio, Math.max(2, Math.round(passi / 3)), pausa, ['137', '140']);
  process.stdout.write(`${riempi(modello('postprocess'), { 'progress.status': 'started', 'progress.postprocessor': 'Merger' })}\n`);
  await attesa(pausa);
}
const file = uscita.replace('%(ext)s', audioSolo ? 'm4a' : 'mp4');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, Buffer.alloc(audioSolo ? audio : video + audio, 0x42));
process.exit(0);

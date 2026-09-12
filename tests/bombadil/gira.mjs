// Un comando: apre Filo su una pagina interna e gli lancia addosso Bombadil.
//
//   node tests/bombadil/gira.mjs [pagina] [durata] [distribuzione-wsl]
//   node tests/bombadil/gira.mjs filo://preferences/preferences.html 5m
//
// Su Windows Bombadil non gira: l'eseguibile esiste solo per Linux e macOS (lo
// dice il suo stesso lanciatore, `bombadil: unsupported platform win32-x64`).
// Quindi da Windows il fuzzer gira dentro WSL e arriva al debugger di Electron
// sul 127.0.0.1 condiviso (serve `networkingMode=mirrored` in `.wslconfig`).
// Su Linux e macOS l'eseguibile si lancia diretto, senza intermediari.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PAGINA = process.argv[2] || 'filo://preferences/preferences.html';
const DURATA = process.argv[3] || '5m';
const DISTRO = process.argv[4] || process.env.FILO_BOMBADIL_WSL || 'Ubuntu-24.04';
const PORTA = Number(process.env.FILO_BOMBADIL_PORTA || 9222);
const USCITA = process.env.FILO_BOMBADIL_USCITA || '/tmp/bombadil-filo';

const binari = join(__dirname, 'node_modules', '@antithesishq', 'bombadil', 'binaries');
const specifica = join(__dirname, 'pagina-interna.ts');

if (!existsSync(binari)) {
  console.error(`Manca Bombadil. Installalo: cd ${__dirname} && npm install`);
  process.exit(1);
}

/** C:\x\y → /mnt/c/x/y, senza scrivere a mano nessun percorso di Windows. */
function aWsl(p) {
  const assoluto = resolve(p);
  const disco = assoluto.slice(0, 1).toLowerCase();
  return `/mnt/${disco}${assoluto.slice(2).split('\\').join('/')}`;
}

function comandoBombadil() {
  const argomenti = [
    'browser', 'test-external',
    '--remote-debugger', `http://127.0.0.1:${PORTA}`,
    '--time-limit', DURATA,
    '--output-path', USCITA,
    '--output-path-overwrite',
  ];
  if (process.platform === 'win32') {
    const eseguibile = '$HOME/.bombadil-linux-x64';
    const sorgente = aWsl(join(binari, 'bombadil-linux-x64'));
    // Copiato nella home della distribuzione: da /mnt/c un eseguibile parte
    // solo se il disco è montato con i permessi giusti, e non è detto che lo sia.
    const riga = [
      `cp -u '${sorgente}' ${eseguibile}`,
      `chmod +x ${eseguibile}`,
      [eseguibile, ...argomenti, `'${PAGINA}'`, `'${aWsl(specifica)}'`].join(' '),
    ].join(' && ');
    return { comando: 'wsl.exe', args: ['-d', DISTRO, '--', 'bash', '-lc', riga] };
  }
  const locale = join(binari, process.platform === 'darwin' ? 'bombadil-darwin-arm64' : 'bombadil-linux-x64');
  return { comando: locale, args: [...argomenti, PAGINA, specifica] };
}

const filo = spawn(process.execPath, [join(__dirname, 'apri-filo.mjs'), PAGINA, String(PORTA)], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

let fermato = false;
function chiudiFilo() {
  if (fermato) return;
  fermato = true;
  try { filo.kill(); } catch (_) {}
}
process.on('SIGINT', () => { chiudiFilo(); process.exit(130); });

async function attendiDebugger() {
  const scadenza = Date.now() + 60_000;
  while (Date.now() < scadenza) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}/json/list`);
      const pagine = (await r.json()).filter((t) => t.type === 'page');
      const pronta = pagine.some((t) => t.url.startsWith(PAGINA));
      const sola = pagine.filter((t) => t.url !== 'filo://shell/shell.html').length === 1;
      if (pronta && sola) return pagine;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('il debugger di Filo non è arrivato pronto in 60 secondi');
}

try {
  const pagine = await attendiDebugger();
  console.log(`[gira] pagine per il debugger: ${pagine.map((t) => t.url).join(', ')}`);
  const { comando, args } = comandoBombadil();
  console.log(`[gira] ${comando} ${args.join(' ')}\n`);
  const esito = await new Promise((r) => {
    const b = spawn(comando, args, { stdio: 'inherit' });
    b.on('exit', (codice) => r(codice ?? 1));
    b.on('error', (e) => { console.error(`[gira] ${e.message}`); r(1); });
  });
  console.log(`\n[gira] Bombadil è uscito con ${esito}`
    + ' (0 = nessuna violazione, 2 = violazioni trovate).');
  console.log(`[gira] per guardare: bombadil browser inspect ${USCITA}`);
  chiudiFilo();
  process.exit(esito);
} catch (errore) {
  console.error(`[gira] ${errore.message}`);
  chiudiFilo();
  process.exit(1);
}

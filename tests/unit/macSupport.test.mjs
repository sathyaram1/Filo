// Sentinella: Filo deve restare disponibile e usabile anche su Mac.
//
// PERCHÉ ESISTE
//   Filo si sviluppa su Windows: chi ci lavora non vede mai un Mac, e le cose
//   che valgono solo per Windows entrano nel codice senza che nessuno se ne
//   accorga — finché un utente Mac scarica un file che non esiste, o preme una
//   scorciatoia che non risponde. Questo test è l'unico controllo che sta
//   sempre acceso: se qualcuno smonta il pacchetto per Mac o scrive una
//   scorciatoia solo-Windows, diventa rosso subito, sulla macchina di chi ha
//   scritto la modifica.
//
//   NON prova che l'app funzioni su Mac (per quello serve un Mac vero): tiene
//   in piedi le condizioni SENZA le quali di sicuro non funziona.
// Pura logica → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('il pacchetto per Mac è ancora previsto dalla configurazione di build', () => {
  const mac = pkg.build?.mac;
  assert.ok(mac, 'build.mac sparito dal package.json: nessuno costruirebbe più la versione per Mac');

  const targets = (Array.isArray(mac.target) ? mac.target : [mac.target])
    .map((t) => (typeof t === 'string' ? t : t?.target));
  assert.ok(targets.includes('dmg'), 'manca il formato dmg: è il file che scarica chi ha un Mac');
  assert.ok(targets.includes('zip'), 'manca il formato zip: senza, gli aggiornamenti automatici su Mac non hanno da dove partire');

  assert.equal(mac.artifactName, 'Filo-Mac.${ext}',
    'il nome del file è cambiato: il collegamento "scarica per Mac" del sito punta a un nome fisso e si romperebbe');
});

test('esistono i comandi per costruire e pubblicare la versione Mac', () => {
  assert.ok(pkg.scripts['build:mac'], 'manca lo script build:mac');
  assert.ok(pkg.scripts['release:mac'], 'manca lo script release:mac');
});

test("l'icona per Mac esiste ed è abbastanza grande", () => {
  const iconPath = join(ROOT, pkg.build.mac.icon);
  assert.ok(existsSync(iconPath), `icona per Mac non trovata: ${pkg.build.mac.icon}`);
  // PNG: larghezza e altezza stanno nell'header, a offset 16 e 20.
  const png = readFileSync(iconPath);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  assert.ok(w >= 512 && h >= 512,
    `l'icona per Mac è ${w}x${h}: sotto 512x512 la costruzione del pacchetto si rifiuta di partire`);
});

test('la firma locale dell\'app Mac è ancora agganciata al build', () => {
  const hook = pkg.build?.afterPack;
  assert.ok(hook, 'build.afterPack sparito: senza firma locale l\'app non parte sui Mac con chip Apple');
  assert.ok(existsSync(join(ROOT, hook)), `il passo di firma non esiste più: ${hook}`);
});

test('la pubblicazione automatica costruisce anche la versione per Mac', () => {
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(wf, /^\s{2}release-mac:/m, 'il lavoro che costruisce la versione Mac è sparito dalla pubblicazione automatica');
  assert.match(wf, /runs-on:\s*macos-latest/, 'la versione per Mac va costruita su una macchina Apple');
  assert.match(wf, /npm run release:mac/, 'la pubblicazione non lancia più la build per Mac');
  // Senza le chiavi incastonate l'app arriva muta: il passo va rifatto anche qui,
  // perché il file generato non viaggia col repo.
  const macJob = wf.slice(wf.search(/^\s{2}release-mac:/m));
  assert.match(macJob, /bake-default-config\.mjs/,
    'il pacchetto Mac verrebbe costruito senza le chiavi di default: arriverebbe agli utenti muto');
});

// ── Sentinella sul codice: le scorciatoie devono valere anche su Mac ────────
// Su Mac il tasto delle scorciatoie è Cmd, non Ctrl. Un controllo che guarda
// solo `ctrlKey` funziona su Windows e tace su Mac — è il modo più comune di
// rompere Filo sui Mac senza accorgersene.

function stripComments(src) {
  let out = '';
  let inBlock = false;
  for (const line of src.split('\n')) {
    let l = line;
    if (inBlock) {
      const end = l.indexOf('*/');
      if (end < 0) { out += '\n'; continue; }
      l = l.slice(end + 2);
      inBlock = false;
    }
    const block = l.indexOf('/*');
    if (block >= 0) {
      const end = l.indexOf('*/', block + 2);
      if (end < 0) { l = l.slice(0, block); inBlock = true; }
      else l = l.slice(0, block) + l.slice(end + 2);
    }
    const line2 = l.indexOf('//');
    if (line2 >= 0) l = l.slice(0, line2);
    out += l + '\n';
  }
  return out;
}

function jsFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsFiles(p, acc);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) acc.push(p);
  }
  return acc;
}

test('nessuna scorciatoia guarda solo il tasto di Windows', () => {
  const colpevoli = [];
  for (const file of jsFiles(join(ROOT, 'src'))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    code.split('\n').forEach((line, i) => {
      if (!/ctrlKey/.test(line)) return;
      if (/metaKey/.test(line)) return;
      colpevoli.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(colpevoli, [],
    'queste righe reagiscono a Ctrl ma non a Cmd: su Mac la scorciatoia non risponde.\n' + colpevoli.join('\n'));
});

test('nessun percorso di Windows scritto a mano nel codice', () => {
  const colpevoli = [];
  for (const file of jsFiles(join(ROOT, 'src'))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    code.split('\n').forEach((line, i) => {
      // %APPDATA% o una lettera di unità: su Mac non esistono.
      if (!/process\.env\.APPDATA|%APPDATA%|['"][A-Z]:\\/.test(line)) return;
      colpevoli.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(colpevoli, [],
    'questi percorsi esistono solo su Windows (usa le cartelle di sistema che Electron ricava da sé):\n' + colpevoli.join('\n'));
});

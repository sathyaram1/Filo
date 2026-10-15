// La sezione «Verifica» nella pagina di una versione (scripts/release-impronte.mjs). Niente rete: gh e le attese sono finti.
// Il posto del passo nella ricetta di pubblicazione lo tiene tests/unit/releaseSuite.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cartellaTemporanea, togliCartella, collegaCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = createRequire(resolve(ROOT, 'package.json'))('./package.json');
const M = await import('../../scripts/release-impronte.mjs');
const { PIATTAFORME } = await import('../../scripts/release-platform-alarm.mjs');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const CORSA = 'https://github.com/proprietario/Filo/actions/runs/123456789';
const ALTRA_CORSA = 'https://github.com/proprietario/Filo/actions/runs/987654321';
const riga = (nome, contenuto, extra = {}) => ({ nome, sha256: sha(contenuto), commit: COMMIT, corsa: CORSA, ...extra });

// Le righe come le legge una persona nella pagina, non dai dati nascosti in fondo alla sezione.
const righeTabella = (corpo) => [...corpo.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|/gm)].map((m) => [m[1], m[2]]);
const sezioni = (corpo) => corpo.split(M.INIZIO).length - 1;

describe('le righe della sezione', () => {
  test('tre file danno tre righe, ognuna col nome e la sua impronta', () => {
    const { corpo } = M.aggiornaCorpo('', [riga('Filo-Setup.exe', 'win'), riga('Filo-Mac.dmg', 'dmg'), riga('Filo-Mac.zip', 'zip')]);
    assert.deepEqual(righeTabella(corpo), [
      ['Filo-Setup.exe', sha('win')],
      ['Filo-Mac.dmg', sha('dmg')],
      ['Filo-Mac.zip', sha('zip')],
    ]);
  });

  test('un secondo passaggio aggiunge le sue righe senza toglierne', () => {
    const primo = M.aggiornaCorpo('', [riga('Filo-Setup.exe', 'win'), riga('Filo-Mac.dmg', 'dmg'), riga('Filo-Mac.zip', 'zip')]).corpo;
    const secondo = M.aggiornaCorpo(primo, [riga('Filo-Linux.AppImage', 'appimage')]).corpo;
    assert.deepEqual(righeTabella(secondo), [
      ['Filo-Setup.exe', sha('win')],
      ['Filo-Mac.dmg', sha('dmg')],
      ['Filo-Mac.zip', sha('zip')],
      ['Filo-Linux.AppImage', sha('appimage')],
    ]);
    assert.equal(sezioni(secondo), 1, 'la sezione si aggiorna al suo posto, non se ne aggiunge un\'altra');
  });

  test('una ripubblicazione che rifà un file ne aggiorna la riga, e dice da quale corsa viene', () => {
    const prima = M.aggiornaCorpo('', [riga('Filo-Setup.exe', 'win'), riga('Filo-Mac.dmg', 'dmg vecchio')]).corpo;
    const dopo = M.aggiornaCorpo(prima, [riga('Filo-Mac.dmg', 'dmg nuovo', { corsa: ALTRA_CORSA })]).corpo;
    assert.deepEqual(righeTabella(dopo), [['Filo-Setup.exe', sha('win')], ['Filo-Mac.dmg', sha('dmg nuovo')]]);
    assert.doesNotMatch(dopo, new RegExp(sha('dmg vecchio')), 'l\'impronta vecchia resterebbe a smentire il file nuovo');
    // Due corse: la testa non può nominarne una sola, la porta ogni riga.
    assert.match(dopo, /^\| `Filo-Setup\.exe` \| `[0-9a-f]{64}` \| \[123456789\]\(https:\/\/github\.com\/proprietario\/Filo\/actions\/runs\/123456789\) \|$/m);
    assert.match(dopo, /^\| `Filo-Mac\.dmg` \| `[0-9a-f]{64}` \| \[987654321\]\(https:\/\/github\.com\/proprietario\/Filo\/actions\/runs\/987654321\) \|$/m);
    assert.match(dopo, new RegExp(`viene dal commit \\[\`${COMMIT}\`\\]`), 'il commit è lo stesso: resta in testa');
  });

  test('i file stanno nell\'ordine Windows, Mac, Linux qualunque sia l\'ordine dei passaggi', () => {
    let corpo = M.aggiornaCorpo('', [riga('Filo-Linux.AppImage', 'l')]).corpo;
    corpo = M.aggiornaCorpo(corpo, [riga('Filo-Mac.zip', 'z'), riga('Filo-Mac.dmg', 'd')]).corpo;
    corpo = M.aggiornaCorpo(corpo, [riga('Filo-Setup.exe', 'w')]).corpo;
    assert.deepEqual(righeTabella(corpo).map(([n]) => n), ['Filo-Setup.exe', 'Filo-Mac.dmg', 'Filo-Mac.zip', 'Filo-Linux.AppImage']);
  });
});

describe('quello che la sezione dice', () => {
  const { corpo } = M.aggiornaCorpo('', [riga('Filo-Setup.exe', 'win')]);

  test('il commit intero, col link, e il link alla corsa che ha costruito', () => {
    assert.match(corpo, /^## Verifica$/m);
    assert.ok(corpo.includes(`[\`${COMMIT}\`](https://github.com/proprietario/Filo/commit/${COMMIT})`), corpo);
    assert.ok(corpo.includes(`(${CORSA})`), 'manca il link alla corsa');
  });

  test('come si controlla, su Windows e su Mac e Linux', () => {
    assert.ok(corpo.includes('`Get-FileHash <file> -Algorithm SHA256`'));
    assert.match(corpo, /PowerShell/);
    assert.ok(corpo.includes('`shasum -a 256 <file>`'));
    // Su alcuni Linux shasum non c'è di serie; sha256sum sta in ogni sistema con gli strumenti di base.
    assert.ok(corpo.includes('`sha256sum <file>`'));
  });

  test('perché ricostruire dal sorgente non dà lo stesso file', () => {
    assert.match(corpo, /chiavi di default/);
    assert.match(corpo, /non dà un file identico/);
  });

  test('il testo che c\'era nella pagina resta, prima e dopo la sezione', () => {
    const prima = M.aggiornaCorpo('Note di questa versione.', [riga('Filo-Setup.exe', 'win')]).corpo;
    assert.match(prima, /^Note di questa versione\.\n\n<!-- filo-verifica:inizio -->/);
    const conCoda = prima + '\nUna riga aggiunta dopo, a mano.\n';
    const dopo = M.aggiornaCorpo(conCoda, [riga('Filo-Linux.AppImage', 'l')]).corpo;
    assert.match(dopo, /^Note di questa versione\./);
    assert.match(dopo, /Una riga aggiunta dopo, a mano\.\n$/);
    assert.equal(righeTabella(dopo).length, 2);
  });
});

describe('quello che non deve entrare nella pagina', () => {
  test('un valore fuori forma non diventa una riga', () => {
    const cattive = [
      riga('Filo-Setup.exe --> <script>alert(1)</script>', 'x'),
      { ...riga('Filo-Setup.exe', 'x'), sha256: 'ABC' },
      { ...riga('Filo-Setup.exe', 'x'), commit: 'abc' },
      { ...riga('Filo-Setup.exe', 'x'), corsa: 'javascript:alert(1)//actions/runs/1' },
    ];
    for (const r of cattive) assert.equal(M.rigaValida(r), false, JSON.stringify(r));
    const { corpo } = M.aggiornaCorpo('', [...cattive, riga('Filo-Mac.dmg', 'd')]);
    assert.deepEqual(righeTabella(corpo).map(([n]) => n), ['Filo-Mac.dmg']);
    assert.doesNotMatch(corpo, /<script>|javascript:/);
  });

  test('gli argomenti sbagliati fermano il passo prima di toccare la pagina', () => {
    const buoni = ['--piattaforma', 'Mac', '--cartella', 'dist', '--versione', 'v1.2.3', '--repo', 'o/r', '--commit', COMMIT, '--corsa', CORSA];
    assert.equal(M.leggiArgomenti(buoni).piattaforma, 'Mac');
    const con = (chiave, valore) => buoni.map((x, i) => (buoni[i - 1] === chiave ? valore : x));
    for (const [chiave, valore] of [
      ['--piattaforma', 'Amiga'], ['--versione', '1.2'], ['--commit', COMMIT.slice(0, 7)],
      ['--corsa', 'https://example.com/x'], ['--repo', 'senza-barra'],
    ]) {
      assert.throws(() => M.leggiArgomenti(con(chiave, valore)), undefined, `${chiave} ${valore} è passato`);
    }
    assert.throws(() => M.leggiArgomenti(buoni.slice(0, -2)), /manca --corsa/);
    assert.throws(() => M.leggiArgomenti([...buoni, '--verifica-dopo', 'tanto']), /verifica-dopo/);
  });

  test('dati della sezione illeggibili: lo si dice, non si riparte in silenzio', () => {
    const rotto = `${M.INIZIO}\n## Verifica\n<!-- filo-verifica:dati {non json -->\n${M.FINE}\n`;
    const { corpo, avvisi } = M.aggiornaCorpo(rotto, [riga('Filo-Setup.exe', 'w')]);
    assert.equal(avvisi.length, 1);
    assert.match(avvisi[0], /non si leggono/);
    assert.equal(sezioni(corpo), 1);
  });
});

const CONTENUTI = {
  'Filo-Setup.exe': 'installer windows',
  'Filo-Mac.dmg': 'disco mac',
  'Filo-Mac.zip': 'pacchetto mac',
  'Filo-Linux.AppImage': 'appimage linux',
};
const allegatiDi = (contenuti) => Object.entries(contenuti).map(([name, c]) => ({ name, digest: `sha256:${sha(c)}` }));

/** Una release finta: gh legge e scrive il suo testo come farebbe con quella vera, e risponde solo coi campi chiesti. */
function releaseFinta({ corpo = '', bozza = false, dopoScrittura, falliscePrime = 0, allegati = allegatiDi(CONTENUTI) } = {}) {
  const stato = { corpo, bozza, scritture: 0, chiamate: [] };
  let fallimenti = falliscePrime;
  const gh = (args) => {
    stato.chiamate.push(args);
    if (fallimenti > 0) {
      fallimenti--;
      throw Object.assign(new Error('Command failed: gh'), { stderr: 'HTTP 502: Bad Gateway\n' });
    }
    if (args[0] === 'release' && args[1] === 'view') {
      const tutto = { body: stato.corpo, isDraft: stato.bozza, assets: allegati };
      return JSON.stringify(Object.fromEntries(args[args.indexOf('--json') + 1].split(',').map((c) => [c, tutto[c]])));
    }
    if (args[0] === 'release' && args[1] === 'edit') {
      stato.corpo = readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
      stato.scritture++;
      dopoScrittura?.(stato);
      return '';
    }
    throw new Error(`chiamata inattesa: gh ${args.join(' ')}`);
  };
  return { gh, stato };
}

function cartellaDist() {
  const dir = cartellaTemporanea('filo-impronte-');
  for (const [nome, c] of Object.entries(CONTENUTI)) writeFileSync(join(dir, nome), c);
  return { dir, contenuti: CONTENUTI };
}

const argv = (piattaforma, cartella, extra = []) => ['--piattaforma', piattaforma, '--cartella', cartella,
  '--versione', 'v9.9.9', '--repo', 'proprietario/Filo', '--commit', COMMIT, '--corsa', CORSA, ...extra];
const senzaAttese = async () => {};

describe('i tre lavori di una pubblicazione', () => {
  test('Windows, poi Linux e Mac: alla fine c\'è una riga per ogni file, con l\'impronta del file vero', async () => {
    const { dir, contenuti } = cartellaDist();
    try {
      const { gh, stato } = releaseFinta({ bozza: true });
      const riassunti = [];
      for (const p of ['Windows', 'Linux', 'Mac']) {
        await M.esegui({ argv: argv(p, dir), gh, attendi: senzaAttese, riassunto: (t) => riassunti.push(t) });
      }
      assert.deepEqual(righeTabella(stato.corpo), Object.entries(contenuti).map(([n, c]) => [n, sha(c)]));
      for (const v of stato.chiamate) assert.deepEqual(v.slice(2, 4), ['v9.9.9', '--repo'], v.join(' '));
      // Il riassunto della corsa porta le stesse impronte della pagina.
      const tutto = riassunti.join('\n');
      for (const [n, c] of Object.entries(contenuti)) assert.ok(tutto.includes(`| \`${n}\` | \`${sha(c)}\` |`), n);
      assert.match(riassunti[0], /Windows/);
      assert.ok(riassunti[0].includes(COMMIT));
    } finally {
      togliCartella(dir);
    }
  });

  test('un file che manca ferma il passo, e la pagina non si tocca', async () => {
    const dir = cartellaTemporanea('filo-impronte-');
    try {
      writeFileSync(join(dir, 'Filo-Mac.dmg'), 'solo il disco');
      const { gh, stato } = releaseFinta();
      await assert.rejects(M.esegui({ argv: argv('Mac', dir), gh, attendi: senzaAttese }), /mancano Filo-Mac\.zip/);
      assert.equal(stato.chiamate.length, 0);
    } finally {
      togliCartella(dir);
    }
  });

  test('gh che inciampa si riprova; gh che non risponde mai ferma il passo con le sue parole', async () => {
    const { dir } = cartellaDist();
    try {
      const una = releaseFinta({ falliscePrime: 1 });
      const attese = [];
      await M.esegui({ argv: argv('Windows', dir), gh: una.gh, attendi: async (ms) => { attese.push(ms); } });
      assert.equal(righeTabella(una.stato.corpo).length, 1);
      assert.deepEqual(attese, [M.ATTESE_RIPROVA_S[0] * 1000]);

      const sempre = releaseFinta({ falliscePrime: 99, bozza: true });
      const errore = await M.esegui({ argv: argv('Windows', dir), gh: sempre.gh, attendi: senzaAttese }).catch((e) => e);
      assert.ok(errore instanceof Error, 'il passo è finito verde senza aver scritto niente');
      assert.match(errore.message, /HTTP 502/);
    } finally {
      togliCartella(dir);
    }
  });

  test('se GitHub fa scaricare un file con un\'altra impronta il passo si ferma, e la pagina non si tocca', async () => {
    const { dir } = cartellaDist();
    try {
      const diverso = allegatiDi({ ...CONTENUTI, 'Filo-Linux.AppImage': 'il file vecchio rimasto su GitHub' });
      const { gh, stato } = releaseFinta({ corpo: 'Note.', bozza: true, allegati: diverso });
      const errore = await M.esegui({ argv: argv('Linux', dir), gh, attendi: senzaAttese }).catch((e) => e);
      assert.ok(errore instanceof Error, 'la pagina riporterebbe un\'impronta che il file scaricato non ha');
      assert.match(errore.message, /Filo-Linux\.AppImage: GitHub dichiara sha256:/);
      assert.equal(errore.bozza, true, 'il riassunto deve poter dire che la versione resta bozza');
      assert.equal(stato.scritture, 0);
      assert.equal(stato.corpo, 'Note.');

      const senzaFile = releaseFinta({ allegati: allegatiDi({ 'Filo-Setup.exe': CONTENUTI['Filo-Setup.exe'] }) });
      await assert.rejects(M.esegui({ argv: argv('Mac', dir), gh: senzaFile.gh, attendi: senzaAttese }), /Filo-Mac\.dmg non è fra gli allegati/);
      assert.equal(senzaFile.stato.scritture, 0);
    } finally {
      togliCartella(dir);
    }
  });

  test('un allegato di cui GitHub non dichiara l\'impronta non ferma il passo, ma lo si dice', async () => {
    const { dir } = cartellaDist();
    try {
      const { gh, stato } = releaseFinta({ allegati: [{ name: 'Filo-Setup.exe', digest: null }] });
      const log = [];
      await M.esegui({ argv: argv('Windows', dir), gh, attendi: senzaAttese, log: (t) => log.push(t) });
      assert.deepEqual(righeTabella(stato.corpo), [['Filo-Setup.exe', sha(CONTENUTI['Filo-Setup.exe'])]]);
      assert.ok(log.some((t) => /::warning::.*non dichiara l'impronta di Filo-Setup\.exe/.test(t)), log.join('\n'));
    } finally {
      togliCartella(dir);
    }
  });

  test('una bozza che resta tale lo dice nel riassunto', () => {
    const testo = M.testoFallimento(Object.assign(new Error('x'), { bozza: true }));
    assert.match(testo, /resta non pubblicata/);
    assert.doesNotMatch(M.testoFallimento(new Error('x')), /bozza/);
  });
});

describe('Mac e Linux scrivono la stessa pagina nello stesso momento', () => {
  const conWindows = () => M.aggiornaCorpo('', [riga('Filo-Setup.exe', 'installer windows')]).corpo;

  test('chi viene coperto se ne accorge rileggendo, e rimette le sue righe sopra quelle dell\'altro', async () => {
    const { dir, contenuti } = cartellaDist();
    try {
      // Linux ha letto la pagina prima che il Mac scrivesse e scrive subito dopo di lui: la sua pagina non ha le righe del Mac.
      const base = conWindows();
      const { gh, stato } = releaseFinta({
        corpo: base,
        dopoScrittura: (s) => {
          if (s.scritture === 1) s.corpo = M.aggiornaCorpo(base, [riga('Filo-Linux.AppImage', contenuti['Filo-Linux.AppImage'])]).corpo;
        },
      });
      const attese = [];
      const esito = await M.esegui({ argv: argv('Mac', dir, ['--verifica-dopo', '45']), gh, attendi: async (ms) => { attese.push(ms); }, caso: () => 0 });
      assert.deepEqual(righeTabella(stato.corpo).map(([n]) => n), ['Filo-Setup.exe', 'Filo-Mac.dmg', 'Filo-Mac.zip', 'Filo-Linux.AppImage']);
      assert.equal(esito.giri, 2);
      assert.ok(attese.every((ms) => ms >= 45_000), 'si rilegge prima che l\'altro abbia potuto scrivere');
    } finally {
      togliCartella(dir);
    }
  });

  test('l\'attesa prima di rileggere supera la finestra in cui l\'altro lavoro può ancora scrivere', () => {
    // Lettura e scrittura altrui stanno ognuna sotto il tetto di gh: oltre, gh viene fermato e si rilegge da capo.
    const yml = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    const valori = [...yml.matchAll(/--verifica-dopo (\d+)/g)].map((m) => Number(m[1]));
    assert.equal(valori.length, 2, 'Mac e Linux rileggono entrambi');
    for (const s of valori) assert.ok(s * 1000 > 2 * M.GH_TETTO_MS, `${s} s non bastano: l'altro può scrivere dopo la rilettura`);
  });

  test('se le righe continuano a sparire il passo non finisce verde', async () => {
    const { dir } = cartellaDist();
    try {
      const base = conWindows();
      const { gh } = releaseFinta({ corpo: base, dopoScrittura: (s) => { s.corpo = base; } });
      await assert.rejects(M.esegui({ argv: argv('Linux', dir, ['--verifica-dopo', '45']), gh, attendi: senzaAttese }),
        new RegExp(`dopo ${M.GIRI} giri`));
    } finally {
      togliCartella(dir);
    }
  });
});

describe('i file scaricabili', () => {
  test('seguono i nomi che il pacchettizzatore produce', () => {
    const nome = (piatt, ext) => PKG.build[piatt].artifactName.replace('${ext}', ext);
    assert.deepEqual(M.SCARICABILI.Windows, [nome('win', 'exe')]);
    assert.deepEqual(M.SCARICABILI.Mac, [nome('mac', 'dmg'), nome('mac', 'zip')]);
    assert.deepEqual(M.SCARICABILI.Linux, [nome('linux', 'AppImage')]);
  });

  test('sono fra i file che il controllo della release esige', () => {
    for (const p of ['Mac', 'Linux']) {
      for (const f of M.SCARICABILI[p]) assert.ok(PIATTAFORME[p].attesi.includes(f), `${f} non è fra gli attesi di ${p}`);
    }
  });
});

// Il workflow lancia una COPIA, da sola, fuori dalla copia di lavoro e dietro un collegamento: deve lavorare lo stesso.
test('la copia dello script, da sola e dietro un collegamento, scrive pagina e riassunto', { skip: process.platform === 'win32' && 'il gh finto è uno script POSIX' }, () => {
  const base = cartellaTemporanea('filo-impronte-cli-');
  try {
    const vero = join(base, 'vero');
    mkdirSync(vero, { recursive: true });
    copyFileSync(join(ROOT, 'scripts', 'release-impronte.mjs'), join(vero, 'release-impronte.mjs'));
    collegaCartella(vero, join(base, 'link'));
    const bin = join(base, 'bin');
    mkdirSync(bin);
    const statoFile = join(base, 'release.json');
    writeFileSync(statoFile, JSON.stringify({ body: 'Note.', isDraft: true, assets: allegatiDi({ 'Filo-Linux.AppImage': 'appimage' }) }));
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(${JSON.stringify(statoFile)}, 'utf8'));
if (a[1] === 'view') { process.stdout.write(JSON.stringify(s)); process.exit(0); }
if (a[1] === 'edit') { s.body = fs.readFileSync(a[a.indexOf('--notes-file') + 1], 'utf8'); fs.writeFileSync(${JSON.stringify(statoFile)}, JSON.stringify(s)); process.exit(0); }
process.exit(3);
`);
    chmodSync(join(bin, 'gh'), 0o755);
    const dist = join(base, 'dist');
    mkdirSync(dist);
    writeFileSync(join(dist, 'Filo-Linux.AppImage'), 'appimage');
    const riassunto = join(base, 'riassunto.md');
    writeFileSync(riassunto, '');
    const r = spawnSync(process.execPath, [join(base, 'link', 'release-impronte.mjs'), ...argv('Linux', dist)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GITHUB_STEP_SUMMARY: riassunto },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const body = JSON.parse(readFileSync(statoFile, 'utf8')).body;
    assert.deepEqual(righeTabella(body), [['Filo-Linux.AppImage', sha('appimage')]], 'lo script è uscito 0 senza scrivere la pagina');
    assert.match(body, /^Note\./);
    assert.ok(readFileSync(riassunto, 'utf8').includes(sha('appimage')), 'il riassunto della corsa non ha le impronte');

    const male = spawnSync(process.execPath, [join(base, 'link', 'release-impronte.mjs'), ...argv('Linux', dist).slice(0, -2)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GITHUB_STEP_SUMMARY: riassunto },
    });
    assert.equal(male.status, 1);
    assert.match(male.stderr, /::error::.*manca --corsa/);
  } finally {
    togliCartella(base);
  }
});

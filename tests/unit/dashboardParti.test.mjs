// Le parti della home (#635): dashboard.js è stato diviso in quattro moduli
// accanto a sé — attività, accoglienza, comandi, terminale.
//
// Tre cose possono rompersi in SILENZIO quando una pagina è fatta di più file,
// e sono tutte e tre qui:
//
//  1. un file nuovo nella cartella che nessuno mette fra gli <script> della
//     pagina: non viene caricato, il suo globale non esiste e la home muore
//     alla prima riga che lo nomina — ma solo a runtime, in una pagina sola;
//  2. un modulo che tocca il DOM mentre si carica: gli <script> stanno in
//     fondo al body, quindi oggi funzionerebbe, e smetterebbe di funzionare il
//     giorno in cui uno li sposta o li rende async. Il patto è che al
//     caricamento un modulo REGISTRI e basta, e che il DOM lo tocchi dentro
//     init();
//  3. una parte che dashboard.js non inizializza: le sue dipendenze restano
//     nulle e salta fuori solo quando l'utente ci passa sopra.
//
// Girano in millisecondi e non aprono Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'src', 'pages', 'dashboard');

const parti = readdirSync(DIR).filter((f) => /^dashboard-.+\.js$/.test(f)).sort();
const html = readFileSync(join(DIR, 'dashboard.html'), 'utf8');
const dashJs = readFileSync(join(DIR, 'dashboard.js'), 'utf8');

test('ogni parte della home è fra gli <script> della pagina, prima di dashboard.js', () => {
  assert.ok(parti.length >= 4, `mi aspetto almeno 4 parti, trovate ${parti.length}`);
  const posizioneDash = html.indexOf('src="dashboard.js"');
  assert.ok(posizioneDash > 0, 'dashboard.html non carica più dashboard.js');
  for (const f of parti) {
    const at = html.indexOf(`src="${f}"`);
    assert.ok(at > 0,
      `${f} sta nella cartella della home ma dashboard.html non lo carica: `
      + 'un modulo che nessuno include non esiste, e la home muore alla prima riga che lo nomina');
    assert.ok(at < posizioneDash,
      `${f} è caricato DOPO dashboard.js: quando dashboard.js lo inizializza, il suo globale non c'è ancora`);
  }
});

test('una parte si carica senza toccare il DOM e registra il suo SN_DASH_*', () => {
  for (const f of parti) {
    // Un contesto SENZA document e SENZA window: se il modulo tocca il DOM
    // mentre si carica, qui esplode. È tutto il punto del controllo.
    const sandbox = {
      SN_MSG: { MSG: new Proxy({}, { get: (_, k) => String(k) }) },
      SN_CONST: { STORAGE_KEYS: new Proxy({}, { get: (_, k) => String(k) }) },
      SN_ONBOARDING: { RESUME_NOTE: '' },
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    assert.doesNotThrow(
      () => vm.runInContext(readFileSync(join(DIR, f), 'utf8'), sandbox, { filename: f }),
      `${f} non si carica in un contesto senza DOM: al caricamento un modulo registra e basta, `
      + 'il DOM lo tocca dentro init()',
    );
    const nuovi = Object.keys(sandbox).filter((k) => k.startsWith('SN_DASH_'));
    assert.equal(nuovi.length, 1, `${f} deve registrare esattamente un globale SN_DASH_*, ne ha ${nuovi.length}`);
    const mod = sandbox[nuovi[0]];
    assert.equal(typeof mod.init, 'function',
      `${nuovi[0]} non espone init(deps): è così che riceve le sue dipendenze dalla home`);
  }
});

test('dashboard.js inizializza tutte le parti che carica', () => {
  for (const f of parti) {
    const sandbox = {
      SN_MSG: { MSG: new Proxy({}, { get: (_, k) => String(k) }) },
      SN_CONST: { STORAGE_KEYS: new Proxy({}, { get: (_, k) => String(k) }) },
      SN_ONBOARDING: { RESUME_NOTE: '' },
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(readFileSync(join(DIR, f), 'utf8'), sandbox, { filename: f });
    const nome = Object.keys(sandbox).find((k) => k.startsWith('SN_DASH_'));
    // dashboard.js prende il modulo (`self.SN_DASH_X`) e lo inizializza: senza
    // la init, le dipendenze restano nulle e salta fuori solo all'uso.
    assert.ok(dashJs.includes(`self.${nome}`),
      `dashboard.js non nomina ${nome}: la parte è caricata dalla pagina ma non la usa nessuno`);
    const alias = dashJs.match(new RegExp(`const (\\w+) = self\\.${nome};`))?.[1];
    assert.ok(alias, `dashboard.js non lega ${nome} a un nome locale`);
    assert.ok(new RegExp(`\\b${alias}\\.init\\(`).test(dashJs),
      `dashboard.js non chiama ${alias}.init(): le dipendenze di ${nome} resterebbero nulle`);
  }
});

test('il blocco di attività si crea con un contenitore esplicito', () => {
  // Il contratto con la home (#635): chi disegna un blocco dice DOVE va,
  // invece di scoprire a posteriori che finisce sempre nelle bolle.
  const att = readFileSync(join(DIR, 'dashboard-attivita.js'), 'utf8');
  assert.match(att, /function createActivity\(container\)/,
    'createActivity deve ricevere il contenitore, non pescarlo da una variabile di pagina');
  assert.match(att, /create: createActivity/, 'SN_DASH_ATTIVITA.create è il nome del contratto');
  assert.ok(!/\bbubblesEl\b/.test(att),
    'dashboard-attivita.js non deve conoscere le bolle della home: il contenitore glielo passa chi chiama');
  for (const chiamata of dashJs.match(/\.create\([^)]*\)/g) || []) {
    assert.notEqual(chiamata, '.create()', 'Att.create() senza contenitore: il blocco non saprebbe dove appendersi');
  }
});

test('l\'aggancio dei test della home non cambia forma', () => {
  // Gli spec della chat (filo-action-levels, filo-open-background-tab,
  // dashboard-command, audit-notes-visibility…) disegnano azioni da qui senza
  // pilotare l'LLM: è la superficie che la divisione doveva lasciare identica.
  const hook = dashJs.match(/window\.__filoDashActions = \{([\s\S]*?)\};/)?.[1];
  assert.ok(hook, 'non trovo window.__filoDashActions in dashboard.js');
  const chiavi = [...hook.matchAll(/^\s*(\w+)[,:]/gm)].map((m) => m[1]).sort();
  assert.deepEqual(chiavi, ['applyCommandCwd', 'getCwd', 'refreshAccountControl', 'renderActions'],
    'la superficie dell\'aggancio è cambiata: gli spec che la usano si romperebbero tutti insieme');
});

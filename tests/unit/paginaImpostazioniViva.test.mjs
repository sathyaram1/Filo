// Sentinella: una pagina di impostazioni aperta non è una fotografia.
// Ogni controllo che un salvataggio riscrive va riallineato quando quella
// stessa impostazione cambia da fuori, o il primo tocco rimanda indietro tutto
// il blocco com'era all'apertura (#667). Il racconto sta nel file di pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Una riga per pagina che salva più impostazioni insieme. `aiutanti` mappa le
// funzioni con cui il salvataggio legge un controllo sul controllo stesso;
// `stati` le copie in memoria da cui riparte (che il riallineamento deve
// riassegnare); `eccezioni` ciò che nessuna altra superficie può cambiare, col
// motivo. Una pagina nuova va aggiunta qui.
const PAGINE = [
  {
    nome: 'Preferenze',
    file: 'src/pages/preferences/preferences.js',
    salvataggi: ['persist', 'persistTokens', 'persistTabColor'],
    riallinea: ['riallineaDaFuori', 'riallineaBlocchiAvanzati'],
    aiutanti: {
      currentStyleText: 'agentStyleText',
      currentModelVoice: 'ttsModelVoice',
      volumeDa: null, // il suo argomento È l'id, e viene letto sotto
    },
    stati: ['currentOverrides', 'currentTabColor'],
    eccezioni: {},
  },
  {
    nome: 'Opzioni',
    file: 'src/pages/options/options.js',
    salvataggi: ['save'],
    riallinea: ['onMessage'],
    aiutanti: {},
    stati: ['modelChains'],
    eccezioni: {
      collectModelRegistry: 'il registro dei modelli si compila solo da questa pagina',
    },
  },
  {
    nome: 'Sicurezza e privacy',
    file: 'src/pages/security/security.js',
    salvataggi: ['save', 'saveCookies', 'saveFingerprint'],
    riallinea: ['applica'],
    aiutanti: {
      currentMode: 'cookie-mode',
      currentFpMode: 'fp-mode',
    },
    stati: ['cookieWhitelist'],
    eccezioni: {},
  },
];

function corpo(sorgente, nome) {
  const inizio = sorgente.search(new RegExp(`function ${nome}\\(|${nome}\\.addListener\\(`));
  assert.ok(inizio >= 0, `non trovo più ${nome}`);
  const fine = sorgente.indexOf('\n  }\n', inizio);
  assert.ok(fine > inizio, `non riesco a delimitare ${nome}`);
  return sorgente.slice(inizio, fine);
}

// Elementi che un salvataggio tocca senza salvarli: la scritta «Salvato», gli
// avvisi. Non sono impostazioni, quindi non c'è niente da riallineare.
const SOLO_AVVISI = new Set(['savedHint', 'tokenSavedHint', 'tabColorSavedHint', 'modelsStatus']);

function campiLetti(testo, aiutanti) {
  const ids = new Set();
  for (const m of testo.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) ids.add(m[1]);
  for (const m of testo.matchAll(/volumeDa\('([A-Za-z0-9_-]+)'\)/g)) ids.add(m[1]);
  for (const [aiutante, id] of Object.entries(aiutanti)) {
    if (id && new RegExp(`\\b${aiutante}\\(`).test(testo)) ids.add(id);
  }
  for (const id of SOLO_AVVISI) ids.delete(id);
  return ids;
}

for (const p of PAGINE) {
  const SORGENTE = readFileSync(join(ROOT, p.file), 'utf8');
  const riallineo = p.riallinea.map((n) => corpo(SORGENTE, n)).join('\n');

  test(`${p.nome}: ogni campo che un salvataggio riscrive viene riallineato`, () => {
    const salvati = new Set();
    for (const s of p.salvataggi) for (const id of campiLetti(corpo(SORGENTE, s), p.aiutanti)) salvati.add(id);
    assert.ok(salvati.size > 3, `i salvataggi di ${p.nome} devono leggere i controlli della pagina`);
    const scoperti = [...salvati].filter((id) => !riallineo.includes(`'${id}'`) && !riallineo.includes(`"${id}"`));
    assert.deepEqual(scoperti, [], `campi salvati ma mai riallineati: ${scoperti.join(', ')}`);
  });

  test(`${p.nome}: la copia in memoria da cui riparte il salvataggio viene rifatta`, () => {
    for (const stato of p.stati) {
      assert.match(riallineo, new RegExp(`${stato}\\s*=`), `${stato} non viene riassegnato al cambio da fuori`);
    }
  });

  test(`${p.nome}: un aiutante nuovo del salvataggio non passa inosservato`, () => {
    const note = new Set([
      ...Object.keys(p.aiutanti), ...Object.keys(p.eccezioni), ...p.salvataggi,
      'parseFloat', 'parseInt', 'Number', 'String', 'Boolean', 'Math', 'sendMessage', 'trim',
      'clampIdleHours', 'clampNotifDurationSec', 'clampParams', 'collect', 'join', 'slice',
      'persist', 'save', 'setTimeout', 'clearTimeout', 'applyTheme', 'applyTextScale',
      'flashSaved', 'parseBlacklist', 'setBlacklistError', 'populateNicknames',
      'markRegistryRowIssues', 'toggle', 'add', 'remove', 'length', 't',
    ]);
    const ignote = new Set();
    for (const s of p.salvataggi) {
      for (const m of corpo(SORGENTE, s).matchAll(/\b([a-zA-Z][A-Za-z0-9_]*)\(/g)) {
        if (!note.has(m[1])) ignote.add(m[1]);
      }
    }
    assert.deepEqual([...ignote], [], `aiutanti nuovi nel salvataggio di ${p.nome}: dichiarali (${[...ignote].join(', ')})`);
  });

  test(`${p.nome}: la pagina ascolta davvero i cambiamenti arrivati da fuori`, () => {
    assert.match(
      SORGENTE,
      /onMessage\.addListener[\s\S]{0,300}SETTINGS_UPDATED/,
      `${p.nome} deve riallinearsi al messaggio di impostazioni cambiate`,
    );
  });

  test(`${p.nome}: il campo che l'utente sta usando non viene riscritto sotto le dita`, () => {
    assert.match(riallineo, /document\.activeElement|activeElement/);
  });
}

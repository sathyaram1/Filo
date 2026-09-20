// Sentinella del passaggio obbligato per le chiamate ai modelli (#591).
//
// Il difetto era di CLASSE, non di istanza: il limite di spesa e il conteggio
// dei costi vivevano nei due cammini principali della chat, e ogni altro
// chiamante doveva ricordarsi di ripeterli. Quattro se n'erano dimenticati.
// Questi test difendono la regola, non le quattro istanze:
//
//   1) STATICA — fuori dal cancello e da `providers/` nessuno arriva a un
//      fornitore. Sul codice del 27 agosto 2026 questa parte era rossa in
//      cinque punti.
//   2) DI COMPORTAMENTO — ogni via d'ingresso del cancello si ferma PRIMA di
//      toccare il fornitore quando il limite mensile è esaurito, e registra il
//      costo quando la chiamata va a buon fine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const require_ = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// 1) La sentinella statica
// ─────────────────────────────────────────────────────────────────────────────

// Chi PUÒ nominare i fornitori: il cancello, i fornitori stessi e il loader,
// che si limita a ri-esporre l'oggetto già registrato su globalThis.
const AMMESSI = new Set([
  'src/main/services/modelGate.js',
  'src/main/services/loader.js',
]);
const CARTELLE_AMMESSE = ['src/main/services/providers/'];

// Le porte da cui si arriva davvero a un fornitore.
// `SN_PROVIDER_` è la porta PRINCIPALE, e all'inizio mancava: un fornitore non
// si trova solo chiedendolo al router, si trova per NOME su globalThis
// (`SN_PROVIDER_<NOME>`) — è così che il router stesso lo trova al suo interno.
// Chi scriveva quella riga arrivava al modello, spendeva sulla chiave condivisa
// e non compariva in nessun conto, con la sentinella verde. Il pezzo di nome
// basta da solo: prende sia `globalThis.SN_PROVIDER_OPENROUTER` sia la forma
// costruita a pezzi (`'SN_PROVIDER_' + nome`).
const PORTE = [
  { nome: 'SN_PROVIDERS', re: /\bSN_PROVIDERS\b/ },
  { nome: 'SN_PROVIDER_<nome>', re: /SN_PROVIDER_/ },
  { nome: 'completeWithFallback', re: /\bcompleteWithFallback\s*\(/ },
  { nome: 'streamCompleteWithFallback', re: /\bstreamCompleteWithFallback\s*\(/ },
  { nome: 'getProvider', re: /\bgetProvider\s*\(/ },
];

function fileJs(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) fileJs(p, out);
    else if (nome.endsWith('.js') || nome.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// Un riferimento dentro un commento non è una chiamata: il difetto era che si
// CHIAMAVA il fornitore, non che se ne parlasse.
//
// Una sentinella che difende una spesa però deve sbagliare SEMPRE dalla parte
// del rosso, e la versione a colpi di espressione regolare sbagliava dall'altra:
// tagliava la riga alla prima coppia di barre e, se quelle barre stavano dentro
// una stringa (un'etichetta come "a//b"), portava via anche la chiamata al
// fornitore scritta dopo, sulla stessa riga. Qui si scorre il testo carattere
// per carattere tenendo il conto di dove ci si trova — codice, stringa,
// template, espressione regolare, commento — e si cancella SOLO quello che sta
// dentro un commento: dal resto non si perde niente.
const APRE_REGEX = /[([{,;:=!&|?+\-*%~^<>]/;

function senzaCommenti(testo) {
  const out = [];
  let stato = 'codice';
  let chiusura = '';
  let inClasse = false; // dentro [...] di un'espressione regolare
  let prima = '';       // ultimo carattere non bianco visto nel codice
  const bianco = (c) => out.push(c === '\n' ? '\n' : ' ');

  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    const d = testo[i + 1];

    if (stato === 'codice') {
      if (c === '/' && d === '/') { stato = 'riga'; out.push(' ', ' '); i++; continue; }
      if (c === '/' && d === '*') { stato = 'blocco'; out.push(' ', ' '); i++; continue; }
      if (c === '"' || c === '\'' || c === '`') { stato = 'stringa'; chiusura = c; out.push(c); prima = c; continue; }
      // Una barra apre un'espressione regolare solo dove una divisione non
      // avrebbe senso: senza questa distinzione le due barre dentro /a\/\/b/
      // verrebbero lette come l'inizio di un commento.
      if (c === '/' && (prima === '' || APRE_REGEX.test(prima))) {
        stato = 'regex'; inClasse = false; out.push(c); prima = c; continue;
      }
      out.push(c);
      if (!/\s/.test(c)) prima = c;
      continue;
    }

    if (stato === 'stringa') {
      out.push(c);
      if (c === '\\') { if (d !== undefined) { out.push(d); i++; } continue; }
      if (c === chiusura) { stato = 'codice'; prima = c; continue; }
      // Apici che non si chiudono sulla riga: è un'analisi andata storta, si
      // torna al codice invece di inghiottire il resto del file.
      if (c === '\n' && chiusura !== '`') { stato = 'codice'; prima = c; }
      continue;
    }

    if (stato === 'regex') {
      out.push(c);
      if (c === '\\') { if (d !== undefined) { out.push(d); i++; } continue; }
      if (c === '[') inClasse = true;
      else if (c === ']') inClasse = false;
      else if ((c === '/' && !inClasse) || c === '\n') { stato = 'codice'; prima = c; }
      continue;
    }

    if (stato === 'riga') {
      if (c === '\n') { stato = 'codice'; out.push('\n'); } else bianco(c);
      continue;
    }

    // blocco
    if (c === '*' && d === '/') { stato = 'codice'; out.push(' ', ' '); i++; continue; }
    bianco(c);
  }
  return out.join('');
}

test('nessuno arriva ai fornitori fuori dal cancello unico', () => {
  const colpevoli = [];
  for (const p of fileJs(join(REPO, 'src'))) {
    const rel = relative(REPO, p).split(sep).join('/');
    if (AMMESSI.has(rel)) continue;
    if (CARTELLE_AMMESSE.some((c) => rel.startsWith(c))) continue;
    const codice = senzaCommenti(readFileSync(p, 'utf8'));
    for (const porta of PORTE) {
      if (porta.re.test(codice)) colpevoli.push(`${rel} → ${porta.nome}`);
    }
  }
  assert.deepEqual(
    colpevoli, [],
    'Queste chiamate saltano il cancello (limite di spesa, conteggio costi, chi ha '
    + 'servito): passa da globalThis.SN_MODEL_GATE.\n' + colpevoli.join('\n'),
  );
});

test('il cancello è caricato dal loader', () => {
  const loader = readFileSync(join(REPO, 'src/main/services/loader.js'), 'utf8');
  assert.match(loader, /modelGate\.js/, 'modelGate.js va aggiunto all\'ordine del loader');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) Il comportamento: il limite ferma OGNI via d'ingresso
// ─────────────────────────────────────────────────────────────────────────────

const Gate = require_(join(REPO, 'src/main/services/modelGate.js'));

const ATTEMPT = { provider: 'finto', apiKey: 'k', model: 'modello-x' };

// Banco di prova: un fornitore che conta quante volte è stato toccato, e un
// conteggio costi che dice se il mese è esaurito.
function banco({ oltreIlLimite = false } = {}) {
  const tocchi = [];
  const registrate = [];
  globalThis.SN_PROVIDERS = {
    completeWithFallback: async (args) => {
      tocchi.push({ metodo: 'completeWithFallback', args });
      return { text: 'ok', usage: { promptTokens: 10, completionTokens: 5 }, servedBy: 'HostFinto' };
    },
    streamCompleteWithFallback: async (args) => {
      tocchi.push({ metodo: 'streamCompleteWithFallback', args });
      return { text: 'ok', usage: { promptTokens: 1, completionTokens: 1 } };
    },
    getProvider: (nome) => {
      if (nome !== 'finto') throw new Error('Provider non supportato: ' + nome);
      return {
        transcribe: async () => { tocchi.push({ metodo: 'transcribe' }); return { text: 'ciao', usage: { costUsd: 0.5 } }; },
        streamComplete: async () => { tocchi.push({ metodo: 'streamComplete' }); return { usage: { completionTokens: 3 } }; },
        lookupServedBy: async () => ({ servedBy: 'HostFinto' }),
      };
    },
  };
  globalThis.SN_COSTS = {
    isOverLimit: async () => oltreIlLimite,
    record: async (r) => { registrate.push(r); return 0.01; },
  };
  Gate.configure({
    modelForAction: () => 'nickname-finto',
    buildAttemptChain: () => [{ ...ATTEMPT }],
    providerRouting: () => null,
    noteServedProvider: (_s, _a, result) => ({ servedBy: (result && result.servedBy) || null, violation: false }),
  });
  return { tocchi, registrate };
}

const SETTINGS = { monthlyLimitEur: 5, usdToEur: 0.92, pricing: {}, excludedProviders: [] };

// Ogni via d'ingresso del cancello, con la chiamata minima che la percorre.
const VIE = {
  complete: (s) => Gate.complete({ settings: s, action: 'azione_x', messages: [] }),
  stream: (s) => Gate.stream({ settings: s, action: 'azione_x', messages: [] }),
  capability: (s) => Gate.capability({
    settings: s, action: 'azione_x', method: 'transcribe',
    run: (P, a) => P.transcribe({ apiKey: a.apiKey }),
  }),
  probe: (s) => Gate.probe({
    settings: s, action: 'prova', provider: 'finto', apiKey: 'k', model: 'modello-x',
    run: (P) => P.streamComplete({}),
  }),
  chain: (s) => Gate.chain({ settings: s, action: 'azione_x' }),
};

for (const [nome, via] of Object.entries(VIE)) {
  test(`col limite esaurito "${nome}" si ferma senza toccare il fornitore`, async () => {
    const b = banco({ oltreIlLimite: true });
    await assert.rejects(() => via(SETTINGS), (e) => e.code === 'LIMIT_REACHED');
    assert.deepEqual(b.tocchi, [], 'il fornitore non deve essere stato chiamato');
    assert.deepEqual(b.registrate, [], 'niente costo per una chiamata mai partita');
  });
}

test('sotto il limite la chiamata parte e il costo finisce nel conto', async () => {
  const b = banco();
  const r = await Gate.complete({ settings: SETTINGS, action: 'azione_x', messages: [] });
  assert.equal(r.text, 'ok');
  assert.equal(r.provider, 'finto');
  assert.equal(r.model, 'modello-x');
  assert.equal(r.servedBy, 'HostFinto', 'chi ha servito va registrato');
  assert.equal(b.registrate.length, 1);
  assert.equal(b.registrate[0].action, 'azione_x');
  assert.equal(b.registrate[0].model, 'modello-x');
  assert.equal(r.costEur, 0.01);
});

test('anche le capacità che non sono una chat contano nel conto', async () => {
  const b = banco();
  const out = await Gate.capability({
    settings: SETTINGS, action: 'dettatura', method: 'transcribe',
    run: (P, a) => P.transcribe({ apiKey: a.apiKey }),
  });
  assert.equal(out.result.text, 'ciao');
  assert.equal(b.registrate.length, 1);
  assert.equal(b.registrate[0].action, 'dettatura');
});

test('una prova dalle Opzioni è una richiesta vera: conta anche lei', async () => {
  const b = banco();
  await Gate.probe({
    settings: SETTINGS, action: 'prova_fornitore', provider: 'finto', apiKey: 'k', model: 'modello-x',
    run: (P) => P.streamComplete({}),
  });
  assert.equal(b.registrate.length, 1);
  assert.equal(b.registrate[0].action, 'prova_fornitore');
});

test('un rifiuto locale non diventa una riga di spesa da zero euro', async () => {
  const b = banco();
  const r = await Gate.probe({
    settings: SETTINGS, action: 'prova_fornitore', provider: 'finto', apiKey: 'k', model: 'modello-x',
    run: async () => ({ ok: false, error: 'questo fornitore non sa indicizzare' }),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(b.registrate, []);
});

test('un mestiere che nessun tentativo sa fare si distingue da un guasto', async () => {
  banco();
  await assert.rejects(
    () => Gate.capability({
      settings: SETTINGS, action: 'indicizzazione', method: 'embed',
      noneError: 'Nessun modello di indicizzazione disponibile', noneCode: 'NO_CAPABLE_MODEL',
      run: () => ({}),
    }),
    (e) => e.code === 'NO_CAPABLE_MODEL',
  );
});

test('un problema di configurazione resta leggibile anche a limite esaurito', async () => {
  banco({ oltreIlLimite: true });
  Gate.configure({
    buildAttemptChain: () => {
      const e = new Error('Nessun modello per questa funzione');
      e.code = 'NO_MODEL_FOR_ACTION';
      throw e;
    },
  });
  await assert.rejects(
    () => Gate.complete({ settings: SETTINGS, action: 'azione_x', messages: [] }),
    (e) => e.code === 'NO_MODEL_FOR_ACTION',
    'chi ha una funzione scoperta deve leggere quello, non "limite raggiunto"',
  );
});

// Riconosce fra i file del repo, che è pubblico, una copia di dati del server: documenti Firestore o feedback già in chiaro.
// Non legge il server e non sposta niente: dice quali file e commit sono copie e perché. Le copie di lavoro stanno in os.tmpdir().
// Sentinella: tests/unit/copieDiDatiFuoriDalRepo.test.mjs.

import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dati finti per le prove: l'unico posto del repo dove una copia è ammessa.
export const CARTELLA_FINTI = 'tests/fixtures/';

const VALORI_FIRESTORE = new Set([
  'stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'timestampValue', 'mapValue',
  'arrayValue', 'nullValue', 'referenceValue', 'geoPointValue', 'bytesValue',
]);
// Chi ha scritto: da soli, o accanto al testo, rendono riconoscibile una persona.
const IDENTITA = ['clientId', 'clientIdHash', 'userAgent', 'walletPseudonym'];

const oggetto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const valoreFirestore = (v) => oggetto(v) && Object.keys(v).length === 1 && VALORI_FIRESTORE.has(Object.keys(v)[0]);
const percorsoFirestore = (s) => /\/databases\/[^/]+\/documents\//.test(s);

function motivoDiUnNodo(o, chiave) {
  if (oggetto(o.fields)) {
    const campi = Object.values(o.fields);
    if (typeof o.name === 'string' && (percorsoFirestore(o.name) || chiave === 'documents')) return 'documento Firestore (name + fields)';
    if (campi.length && campi.some(valoreFirestore)) return 'campi nel formato di Firestore (stringValue, integerValue…)';
  }
  const presenti = IDENTITA.filter((k) => typeof o[k] === 'string');
  if (presenti.length && presenti.length + (typeof o.text === 'string' ? 1 : 0) >= 2) {
    return `campi di un feedback in chiaro (${[...(typeof o.text === 'string' ? ['text'] : []), ...presenti].join(', ')})`;
  }
  return '';
}

/** Il motivo per cui un valore JSON è una copia di dati del server, o ''. Scende in tutto l'albero. */
export function motivoCopia(radice) {
  const pila = [[radice, '']];
  while (pila.length) {
    const [v, chiave] = pila.pop();
    if (Array.isArray(v)) {
      for (const x of v) pila.push([x, chiave]);
    } else if (oggetto(v)) {
      const m = motivoDiUnNodo(v, chiave);
      if (m) return m;
      for (const [k, x] of Object.entries(v)) if (x && typeof x === 'object') pila.push([x, k]);
    }
  }
  return '';
}

/** Come motivoCopia, sul testo di un file: JSON intero, o una riga JSON per documento. Un testo che non è JSON → ''. */
export function motivoCopiaTesto(testo) {
  const t = String(testo || '').replace(/^﻿/, '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return '';
  try { return motivoCopia(JSON.parse(t)); } catch (_) { /* può essere una riga per documento */ }
  for (const riga of t.split(/\r?\n/)) {
    const r = riga.trim();
    if (!r.startsWith('{') && !r.startsWith('[')) continue;
    try {
      const m = motivoCopia(JSON.parse(r));
      if (m) return m;
    } catch (_) { /* riga non JSON: non dice niente */ }
  }
  for (const o of oggettiChiusi(t)) {
    const m = motivoCopia(o);
    if (m) return m;
  }
  return motivoInterrotto(t);
}

// Un pezzo più corto del primo documento non chiude nessun oggetto, ma porta già una persona: lo dicono le chiavi scritte.
const PERCORSO_INTERROTTO = /"name"\s*:\s*"[^"]*\/databases\/[^"/]+\/documents\//;
const IDENTITA_FIRESTORE = new RegExp(`"(?:${IDENTITA.join('|')})"\\s*:\\s*\\{\\s*"stringValue"`);
function motivoInterrotto(t) {
  if (PERCORSO_INTERROTTO.test(t)) return 'documento Firestore (name + fields), interrotto';
  if (IDENTITA_FIRESTORE.test(t)) return 'campi nel formato di Firestore (stringValue, integerValue…), interrotto';
  const presenti = [...IDENTITA, 'text'].filter((k) => new RegExp(`"${k}"\\s*:\\s*"`).test(t));
  if (presenti.length >= 2 && presenti.some((k) => k !== 'text')) return `campi di un feedback in chiaro (${presenti.join(', ')}), interrotto`;
  return '';
}

// Gli oggetti chiusi dentro un JSON interrotto: una copia salvata a metà («le prime 300 righe») resta riconoscibile
// dai documenti interi che contiene. Solo le graffe fuori dalle stringhe contano.
function* oggettiChiusi(t) {
  const aperti = [];
  let inStringa = false;
  let escape = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStringa) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStringa = false;
    } else if (c === '"') inStringa = true;
    else if (c === '{') aperti.push(i);
    else if (c === '}' && aperti.length) {
      const da = aperti.pop();
      let o;
      try { o = JSON.parse(t.slice(da, i + 1)); } catch (_) { continue; }
      yield o;
    }
  }
}

// Il primo carattere visibile, letto sui byte: immagini e caratteri non si decodificano per niente.
function sembraJson(byte) {
  let i = byte[0] === 0xEF && byte[1] === 0xBB && byte[2] === 0xBF ? 3 : 0;
  while (i < byte.length && (byte[i] === 0x20 || byte[i] === 0x09 || byte[i] === 0x0A || byte[i] === 0x0D)) i++;
  return byte[i] === 0x7B || byte[i] === 0x5B;
}

// Il motivo per cui il file `f` di `root` è una copia, o '': fuori dai dati finti, solo se comincia come un JSON.
function motivoFile(root, f) {
  if (f.startsWith(CARTELLA_FINTI)) return '';
  let byte;
  try { byte = readFileSync(join(root, f)); } catch (_) { return ''; }
  return sembraJson(byte) ? motivoCopiaTesto(byte.toString('utf8')) : '';
}

function copieFra(root, file) {
  const trovate = [];
  for (const f of file) {
    const motivo = motivoFile(root, f);
    if (motivo) trovate.push({ file: f, motivo });
  }
  return trovate;
}

const elencoGit = (root, args) => execFileSync('git', [...args, '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean);

/** I file tracciati da git in `root` che sono copie di dati del server, fuori dalla cartella dei dati finti. */
export function copieNelRepo(root) {
  return copieFra(root, elencoGit(root, ['ls-files']));
}

/** Come copieNelRepo, sui soli file messi in scena (aggiunti o cambiati): il salvataggio li toglie prima del commit. */
export function copieInScena(root) {
  return copieFra(root, elencoGit(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR']));
}

const gitTesto = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Le copie nei commit che spedire `rif` porterebbe su origin (quelli che nessun ramo di origin conosce),
 * dal commit più vecchio: [{ commit, file, motivo }]. Ogni strada che spedisce lo chiede prima del push.
 */
export function copieDaSpedire(root, rif = 'HEAD', { giaLa = ['--remotes=origin'] } = {}) {
  const commit = gitTesto(root, ['rev-list', '--reverse', rif, '--not', ...giaLa]).split('\n').filter(Boolean);
  const trovate = [];
  const lette = new Map();
  for (const c of commit) {
    const voci = gitTesto(root, ['diff-tree', '-r', '--root', '--no-commit-id', '--raw', '-z', '--diff-filter=ACMR', c]).split('\0');
    for (let i = 0; i < voci.length - 1;) {
      const meta = voci[i].split(' ');
      const rinomina = /^[RC]/.test(meta[4] || '');
      const file = voci[i + (rinomina ? 2 : 1)];
      i += rinomina ? 3 : 2;
      if (!file || file.startsWith(CARTELLA_FINTI)) continue;
      const blob = meta[3];
      if (!lette.has(blob)) {
        const byte = execFileSync('git', ['cat-file', 'blob', blob], { cwd: root, maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        lette.set(blob, sembraJson(byte) ? motivoCopiaTesto(byte.toString('utf8')) : '');
      }
      if (lette.get(blob)) trovate.push({ commit: c, file, motivo: lette.get(blob) });
    }
  }
  return trovate;
}

/**
 * Prima di spedire: se i commit da spedire portano copie, le toglie dalla loro storia rifacendoli in un commit solo
 * (sono solo locali; il resto del lavoro resta e parte). { stato: 'pulito'|'riparato'|'fermo', avviso }: con 'fermo'
 * (una fusione in mezzo, il primo commit del repo) non si spedisce, e l'avviso dice come toglierle a mano.
 */
export function spedibileSenzaCopie(root, { nome = 'claude-local', email = 'claude@local' } = {}) {
  const copie = copieDaSpedire(root);
  if (!copie.length) return { stato: 'pulito', avviso: '' };
  const fermo = { stato: 'fermo', avviso: avvisoSpedizione(copie) };
  const g = (args) => gitTesto(root, args).trim();
  const primo = copie[0].commit;
  let base;
  try { base = g(['rev-parse', '--verify', '-q', `${primo}~1`]); } catch (_) { return fermo; }
  if (g(['rev-list', '--merges', `${base}..HEAD`])) return fermo;
  const soggetti = g(['log', '--reverse', '--format=%s', `${base}..HEAD`]).split('\n').filter(Boolean);
  const file = [...new Set(copie.map((c) => c.file))];
  const testa = g(['rev-parse', 'HEAD']);
  try {
    g(['reset', '-q', '--soft', base]);
    // Solo i file che in cima sono ancora copie tornano come alla base: uno corretto dopo resta com'è adesso.
    const restano = file.filter((f) => {
      try { return motivoCopiaTesto(gitTesto(root, ['show', `${testa}:${f}`])); } catch (_) { return false; }
    });
    if (restano.length) g(['reset', '-q', base, '--', ...restano]);
    try { escludiInLocale(root, restano); } catch (_) { /* il controllo sui file in scena li rivede */ }
    let vuoto = true;
    try { g(['diff', '--cached', '--quiet']); } catch (_) { vuoto = false; }
    if (!vuoto) {
      g(['-c', `user.name=${nome}`, '-c', `user.email=${email}`, 'commit', '-q', '-m',
        `${soggetti.join(' + ').slice(0, 200)} (senza la copia dei dati: ${file.join(', ')})`]);
    }
  } catch (_) {
    try { g(['reset', '-q', '--soft', testa]); } catch (__) { /* resta il messaggio */ }
    return fermo;
  }
  if (copieDaSpedire(root).length) return fermo;
  return {
    stato: 'riparato',
    avviso: `${file.join(', ')} ha la forma di una copia dei dati del server (${copie[0].motivo}) e il repo e' pubblico: `
      + `l'ho tolto dai commit non ancora spediti, rifatti in uno solo (il lavoro resta), e il ramo parte senza. `
      + `La copia resta nella cartella, invisibile a git: spostala nella cartella temporanea del sistema (os.tmpdir()).`,
  };
}

const citaShell = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Cosa dire a chi spedisce quando copieDaSpedire ha trovato qualcosa: il ramo non parte, e come toglierle dalla storia. */
export function avvisoSpedizione(copie) {
  const file = [...new Set(copie.map((c) => c.file))];
  const primo = copie[0].commit.slice(0, 10);
  return `NON spedisco il ramo: ${file.join(', ')} (dal commit ${primo}) ha la forma di una copia dei dati del server `
    + `(${copie[0].motivo}), e il repo e' pubblico: una volta spedita resta nella storia anche se tolta dopo. `
    + `Toglila dalla storia del ramo e sposta la copia nella cartella temporanea del sistema (os.tmpdir()): `
    + `git reset --soft ${primo}~1 && git rm -q --cached --ignore-unmatch -- ${file.map(citaShell).join(' ')} && git commit -m "lavoro senza la copia dei dati" `
    + `(rifa' in un commit solo i commit da li' in poi, il lavoro resta). Poi il salvataggio spedisce.`;
}

// Un nome in .gitignore: le / restano, i caratteri speciali e gli spazi in coda si citano.
const comeEsclusione = (f) => `/${f.replace(/[\\*?[]/g, '\\$&').replace(/ $/, '\\ ')}`;

/**
 * Toglie dalla vista di git, in questa copia soltanto (info/exclude, non versionato), le copie lasciate nella
 * cartella: senza, «git add -A» — che la consegna chiede davanti a una cartella sporca — le rimetteva nel commit.
 */
export function escludiInLocale(root, file) {
  const dove = resolve(root, gitTesto(root, ['rev-parse', '--git-path', 'info/exclude']).trim());
  let attuale = '';
  try { attuale = readFileSync(dove, 'utf8'); } catch (_) { mkdirSync(dirname(dove), { recursive: true }); }
  const righe = new Set(attuale.split(/\r?\n/));
  const nuove = file.filter((f) => !/[\r\n]/.test(f)).map(comeEsclusione).filter((r) => !righe.has(r));
  if (!nuove.length) return;
  appendFileSync(dove, `${attuale && !attuale.endsWith('\n') ? '\n' : ''}${nuove.join('\n')}\n`);
}

const VUOTO = /^0+$/;

/**
 * Il controllo di git prima di ogni push (hook pre-push): `righe` è ciò che git passa su stdin. Le copie nei commit che
 * il push porterebbe dove non sono ancora; [] se non ce ne sono. È l'unica regola che vale per ogni strada che spedisce.
 */
export function copieNelPush(root, righe) {
  const trovate = [];
  for (const riga of String(righe || '').split(/\r?\n/)) {
    const [, locale, , remoto] = riga.trim().split(/\s+/);
    if (!locale || VUOTO.test(locale)) continue;
    const giaLa = ['--remotes'];
    if (remoto && !VUOTO.test(remoto)) {
      try { gitTesto(root, ['cat-file', '-e', `${remoto}^{commit}`]); giaLa.push(remoto); } catch (_) { /* non l'abbiamo: conta --remotes */ }
    }
    trovate.push(...copieDaSpedire(root, locale, { giaLa }));
  }
  return trovate;
}

// Il segno che riconosce il pre-push di Filo. Quello di prima si riconosce ancora, per sostituirlo; il nuovo non lo porta,
// così gli strumenti di un ramo vecchio lo vedono altrui e non lo riscrivono senza le spinte.
export const SEGNO_PRE_PUSH = 'filo-pre-push';
const SEGNO_VECCHIO = 'filo-copie-di-dati';
// Di riserva, se la cartella che spedisce non ha lo script (un ramo vecchio): quello di chi ha installato.
const RISERVA = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'copie-in-scena.mjs').replace(/\\/g, '/');
const RISERVA_SPINTE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dichiara-spinte.mjs').replace(/\\/g, '/');
const tra = (s) => `'${s.replace(/'/g, "'\\''")}'`;

/** Il pezzo che accoda le spinte (#1362). `soloRiserva`: lo script è sempre quello di chi installa (il clone del server). */
function bloccoSpinte(repo, soloRiserva) {
  const scelta = soloRiserva ? `spinte=${tra(RISERVA_SPINTE)}`
    : `spinte="$radice/scripts/dichiara-spinte.mjs"\n  [ -f "$spinte" ] || spinte=${tra(RISERVA_SPINTE)}`;
  return `radice=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
command -v node >/dev/null 2>&1 || exit 0
righe=$(cat)
# Le spinte col biglietto di chi spinge (#1362): node costa a ogni push, quindi solo se c'e' un biglietto da cui farlo.
principale=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); principale=\${principale%/.git}
if [ -n "$CLAUDE_CODE_SESSION_ID$FILO_BIGLIETTO_FILE$FILO_ROUTINE_TICKET" ] || [ -f "$radice/.claude/routine-ticket.json" ] || [ -f "$principale/.claude/routine-ticket.json" ]; then
  ${scelta}
  [ -f "$spinte" ] && printf '%s\\n' "$righe" | node "$spinte" --pre-push ${repo} "$radice" "$2" >/dev/null 2>&1
fi
`;
}

const PRE_PUSH = `#!/bin/sh
# ${SEGNO_PRE_PUSH}: su ogni strada che spinge, anche un git push a mano, accoda le spinte col biglietto di chi spinge (#1362)
# e ferma una copia dei dati del server (#1108). Lo scrive scripts/lib/copie-di-dati.mjs; gli script sono quelli della
# cartella che spedisce, o di chi l'ha installato.
${bloccoSpinte('app', false)}controllo="$radice/scripts/copie-in-scena.mjs"
[ -f "$controllo" ] || controllo=${tra(RISERVA)}
[ -f "$controllo" ] || exit 0
# Il controllo delle copie si chiama solo se i commit da spedire portano qualcosa che non e' codice o immagine.
dati=$(printf '%s\\n' "$righe" | while read -r _ locale _ _; do
  case "$locale" in *[!0]*) ;; *) continue ;; esac
  git log --format= --name-only --diff-filter=ACMR "$locale" --not --remotes 2>/dev/null
done | grep -vE '\\.(js|mjs|cjs|ts|css|html|md|sh|ps1|png|jpe?g|gif|webp|svg|ico)$' | grep -m1 .)
[ -n "$dati" ] || exit 0
printf '%s\\n' "$righe" | node "$controllo" --pre-push "$radice"
`;

// Nel clone di filo-security delle sessioni locali: solo le spinte, con lo script di Filo di chi installa.
const PRE_PUSH_SERVER = `#!/bin/sh
# ${SEGNO_PRE_PUSH}: su ogni strada che spinge su filo-security accoda le spinte col biglietto della sessione di Filo che
# spinge (#1362). Lo scrive scripts/lib/copie-di-dati.mjs di Filo.
${bloccoSpinte('server', true)}exit 0
`;

function installa(root, contenuto) {
  try { if (gitTesto(root, ['config', '--get', 'core.hooksPath']).trim()) return 'altrove'; } catch (_) { /* non impostato */ }
  const dove = resolve(root, gitTesto(root, ['rev-parse', '--git-path', 'hooks/pre-push']).trim());
  let attuale = null;
  try { attuale = readFileSync(dove, 'utf8'); } catch (_) { /* non c'è */ }
  if (attuale === contenuto) return 'presente';
  if (attuale !== null && !attuale.includes(SEGNO_PRE_PUSH) && !attuale.includes(SEGNO_VECCHIO)) return 'altrui';
  mkdirSync(dirname(dove), { recursive: true });
  writeFileSync(dove, contenuto, { mode: 0o755 });
  try { chmodSync(dove, 0o755); } catch (_) { /* su Windows git lo lancia comunque */ }
  return 'installato';
}

/**
 * Mette il controllo prima di ogni push nella copia del repo di `root` (gli hook di git valgono per tutte le sue cartelle).
 * 'installato' | 'presente' | 'altrui' (un pre-push non nostro: non si tocca) | 'altrove' (core.hooksPath: la cartella
 * degli hook è condivisa con altri repo, non ci si scrive).
 */
export function installaControlloSpedizione(root) {
  return installa(root, PRE_PUSH);
}

/** Lo stesso nel clone di filo-security di una sessione locale: le sue spinte si dichiarano come quelle di Filo (#1362). */
export function installaSpinteServer(root) {
  return installa(root, PRE_PUSH_SERVER);
}

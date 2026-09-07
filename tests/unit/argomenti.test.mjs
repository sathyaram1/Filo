// Unit test del controllo degli argomenti a riga di comando.
//
// PERCHÉ CONTA
//   Ogni riga qui sotto è una porta trovata sul campo, dove uno strumento
//   faceva la cosa VERA per un argomento che non aveva capito: un feedback
//   aperto senza l'allegato, un giro «a vuoto» che scriveva davvero, e nel
//   caso peggiore la chiave dei feedback rigenerata, che rende illeggibile
//   tutto quello che era stato cifrato con la vecchia.

import test from 'node:test';
import assert from 'node:assert/strict';

const { controllaArgomenti, sembraOpzione, normalizza, argomentiDaNpm, espandiUguali, opzioneStorpiata } = await import('../../scripts/lib/argomenti.mjs');

const FEEDBACK = {
  opzioni: ['--priorita', '--url', '--allega', '--dry-run'],
  conValore: ['--priorita', '--url', '--allega'],
};

test('la riga scritta bene passa', () => {
  assert.equal(controllaArgomenti(['titolo', 'testo', '--allega', 'spec.md', '--dry-run'], FEEDBACK), null);
  assert.equal(controllaArgomenti(['titolo', 'testo', '--priorita', '2'], FEEDBACK), null);
  assert.equal(controllaArgomenti([], FEEDBACK), null);
});

test('un nome sbagliato è respinto, e il rifiuto dice cosa è ammesso', () => {
  const m = controllaArgomenti(['t', 'x', '--allgea', 'spec.md'], FEEDBACK);
  assert.match(m, /opzione sconosciuta --allgea/);
  assert.match(m, /non ho toccato niente/);
  assert.match(m, /--allega/, 'il rifiuto elenca le opzioni ammesse');
});

test('un trattino solo NON vale come due: il nome è giusto ma la riga no', () => {
  // La porta vera: «-allega spec.md» faceva finire opzione e nome del file
  // dentro al testo del feedback, che veniva aperto lo stesso.
  assert.match(controllaArgomenti(['t', 'x', '-allega', 'spec.md'], FEEDBACK), /va scritta --allega/);
  assert.match(controllaArgomenti(['t', 'x', '-dry-run'], FEEDBACK), /va scritta --dry-run/);
});

test('i trattini lunghi del copia-incolla sono respinti come tali', () => {
  for (const trattino of ['–', '—', '‐', '−']) {
    const m = controllaArgomenti(['t', 'x', `${trattino}dry-run`], FEEDBACK);
    assert.match(m, /va scritta --dry-run/, `il trattino ${trattino} deve essere riconosciuto`);
  }
});

test('un\'opzione che vuole un valore e non ce l\'ha è respinta, non ignorata', () => {
  assert.match(controllaArgomenti(['t', 'x', '--allega'], FEEDBACK), /vuole un valore/);
  assert.match(controllaArgomenti(['t', 'x', '--priorita', '--dry-run'], FEEDBACK), /vuole un valore/);
  // Il valore di un'opzione non viene riesaminato come argomento a sé: un
  // titolo che comincia per trattino resta un valore, non un'opzione.
  assert.equal(controllaArgomenti(['t', 'x', '--url', 'https://x.it', '--dry-run'], FEEDBACK), null);
});

test('quello che non è un\'opzione resta quello che è', () => {
  assert.equal(sembraOpzione('-'), false, '«-» da solo è stdin');
  assert.equal(sembraOpzione('-3'), false, 'un numero negativo non è un\'opzione');
  assert.equal(sembraOpzione('titolo'), false);
  assert.equal(sembraOpzione('--dry-run'), true);
  assert.equal(controllaArgomenti(['t', '-'], FEEDBACK), null);
  assert.equal(normalizza('-dry-run'), '--dry-run');
  assert.equal(normalizza('–dry-run'), '--dry-run');
});

test('lo strumento con una sola opzione: tutto il resto è respinto', () => {
  const SOLO_DRY = { opzioni: ['--dry-run'] };
  assert.equal(controllaArgomenti(['--dry-run'], SOLO_DRY), null);
  assert.match(controllaArgomenti(['--dryrun'], SOLO_DRY), /opzione sconosciuta/);
  assert.match(controllaArgomenti(['-dry-run'], SOLO_DRY), /va scritta --dry-run/);
  assert.match(controllaArgomenti(['--print'], SOLO_DRY), /opzione sconosciuta/);
});

test("la forma di Windows vale come un'opzione, ma solo se il nome e' di una che conosco", () => {
  assert.match(controllaArgomenti(['/dry-run'], { opzioni: ['--dry-run'] }), /va scritta --dry-run/);
  assert.match(controllaArgomenti(['t', 'x', '/allega', 'spec.md'], FEEDBACK), /va scritta --allega/);
  // Un percorso che comincia per barra resta un percorso: non lo si prende
  // per un'opzione scritta male.
  assert.equal(controllaArgomenti(['t', '/tmp/appunti.md'], FEEDBACK), null);
});

// ── Le opzioni che npm si mangia ─────────────────────────────────────────────
//
// `npm run feedback:apri --allega spec.md` non le passa allo strumento: se le
// prende npm. Su PowerShell succede anche con la forma «giusta», dopo i due
// trattini. Rifiutare una riga che chi la scrive considera giusta sarebbe
// attrito: si riprende dall'ambiente, e lo si dice.

test("le opzioni finite a npm si riprendono dall'ambiente, con la nota", () => {
  const r = argomentiDaNpm({ npm_config_dry_run: 'true' }, { opzioni: ['--dry-run'] });
  assert.deepEqual(r.args, ['--dry-run']);
  assert.match(r.nota, /--dry-run/);
  const c = argomentiDaNpm({ npm_config_allega: 'spec.md' }, FEEDBACK);
  assert.deepEqual(c.args, ['--allega', 'spec.md']);
});

test("senza niente nell'ambiente non si inventa niente", () => {
  const r = argomentiDaNpm({}, FEEDBACK);
  assert.deepEqual(r.args, []);
  assert.equal(r.nota, null);
  // Un'opzione che vuole un valore, ma di cui npm ha registrato solo «true»,
  // non si indovina: meglio il rifiuto del controllo normale.
  assert.deepEqual(argomentiDaNpm({ npm_config_allega: 'true' }, FEEDBACK).args, []);
});

test("un'opzione col valore mangiato da npm ferma tutto e dice come si scrive", () => {
  // npm spezza `--allega spec.md` in due: si tiene il nome (come «true») e
  // passa allo strumento il solo valore, che scala e diventa il titolo.
  const r = argomentiDaNpm({ npm_config_allega: 'true' }, FEEDBACK);
  assert.deepEqual(r.args, []);
  assert.equal(r.nota, null);
  assert.match(r.errore, /senza il suo valore/);
  assert.match(r.errore, /--allega=<valore>/, 'dice la forma che regge');
  assert.match(r.errore, /non ho toccato niente/);
});

test("la forma con l'uguale, che consigliamo per npm, funziona anche quando arriva intera", () => {
  // Consigliarla e poi rifiutarla è il modo migliore di far girare a vuoto chi
  // segue il consiglio stampato.
  assert.deepEqual(espandiUguali(['t', 'x', '--allega=spec.md'], FEEDBACK.conValore), ['t', 'x', '--allega', 'spec.md']);
  assert.equal(controllaArgomenti(espandiUguali(['t', 'x', '--allega=spec.md'], FEEDBACK.conValore), FEEDBACK), null);
  // Un'opzione senza valore non si tocca, e nemmeno un testo con un uguale.
  assert.deepEqual(espandiUguali(['--dry-run', 'a=b'], FEEDBACK.conValore), ['--dry-run', 'a=b']);
  // Scritta con l'uguale ma sconosciuta: rifiutata come le altre.
  assert.match(controllaArgomenti(['--allgea=spec.md'], FEEDBACK), /opzione sconosciuta --allgea/);
  assert.match(controllaArgomenti(['--dry-run=1'], FEEDBACK), /non vuole un valore/);
});

// ── L'opzione scritta male che npm si porta via ──────────────────────────────
//
// Il recupero conosce i nomi giusti; il nome SBAGLIATO npm se lo porta via lo
// stesso, e allo strumento non arriva niente da rifiutare: la cosa vera
// partirebbe in silenzio. Il residuo nell'ambiente è l'unico segnale.

test('un nome sbagliato lasciato da npm viene riconosciuto e ferma tutto', () => {
  assert.match(opzioneStorpiata({ npm_config_allgea: 'spec.md' }, ['--allega', '--dry-run']), /--allgea non esiste/);
  assert.match(opzioneStorpiata({ npm_config_allgea: 'spec.md' }, ['--allega']), /forse intendevi --allega/);
  assert.match(opzioneStorpiata({ npm_config_dryrun: 'true' }, ['--dry-run']), /--dry-run/);
  assert.match(opzioneStorpiata({ npm_config_chek: 'true' }, ['--check']), /--check/);
});

test('la roba di npm non viene scambiata per un nostro errore', () => {
  const AMBIENTE_NPM = {
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_cache: 'C:/npm-cache',
    npm_config_prefix: 'C:/npm',
    npm_config_color: 'true',
    npm_config_user_agent: 'npm/10',
    npm_config_global: '',
  };
  const NOSTRE = ['--check', '--dry-run', '--allega', '--url', '--priorita', '--print', '--frase', '--branch', '--reason'];
  assert.equal(opzioneStorpiata(AMBIENTE_NPM, NOSTRE), null);
  // E un'opzione scritta GIUSTA non è un errore: la riprende chi di dovere.
  assert.equal(opzioneStorpiata({ npm_config_dry_run: 'true' }, ['--dry-run']), null);
});

// Il rovescio della medaglia, e va tenuto: si guardano SOLO i nomi vicini ai
// nostri. Segnalare tutto ciò che non stesse in un elenco di configurazioni di
// npm ha spento ogni scorciatoia del progetto, perché npm nell'ambiente mette
// roba sua che nessun elenco scritto a mano contiene tutta.
test('le impostazioni di npm non vengono scambiate per nostri errori', () => {
  const AMBIENTE_VERO = {
    npm_config_global_prefix: 'C:/npm', npm_config_local_prefix: '.', npm_config_registry: 'r',
    npm_config_loglevel: 'error', npm_config_init_module: 'x', npm_config_user_agent: 'npm/10',
  };
  const NOSTRE = ['--allega', '--dry-run', '--check', '--print', '--url', '--priorita'];
  assert.equal(opzioneStorpiata(AMBIENTE_VERO, NOSTRE), null);
  // Un nome lontano dai nostri resta fuori portata: è il prezzo, ed è meno
  // caro di uno strumento che rifiuta tutto.
  assert.equal(opzioneStorpiata({ npm_config_attach: 'spec.md' }, ['--allega']), null);
});

test("l'opzione con la barra trasformata in percorso dalla conchiglia viene riconosciuta", () => {
  // Su Windows la conchiglia di Git riscrive `/dry-run` come percorso prima di
  // consegnarlo: lì la barra davanti non si vede più, e la modalità che non
  // spedisce non si accendeva mentre il feedback partiva davvero.
  const m = controllaArgomenti(['t', 'x', 'C:/Program Files/Git/dry-run'], FEEDBACK);
  assert.match(m, /--dry-run/);
  assert.match(m, /non ho toccato niente/);
  // Un percorso vero non viene scambiato per un'opzione.
  assert.equal(controllaArgomenti(['t', 'C:/Users/x/appunti.md'], FEEDBACK), null);
});

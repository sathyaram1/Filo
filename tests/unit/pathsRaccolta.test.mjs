// La pipeline che salva un percorso quando dici «ha funzionato», dalla sessione
// grezza della sidebar fino al corpo della richiesta che parte per Firestore
// (pathsCollector → SN_PATHS.submit → rete finta).
//
// Perché esiste (audit pre-alpha, #584). Il pezzo di mezzo prendeva `userAgent`
// e `clientId` dal chiamante e li infilava nel documento condiviso: chi legge i
// percorsi non se ne è mai fatto niente, e bastavano a ricucire i percorsi
// della stessa persona su domini diversi. Qui si guarda l'unica cosa che conta
// davvero — cosa ESCE dal computer — invece di fidarsi del fatto che oggi
// nessuno passi più quei due argomenti.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'paths.js'));
require(join(ROOT, 'src', 'main', 'services', 'pathsCollector.js'));

const { ACTIONS } = globalThis.SN_CONST;
const Collector = globalThis.SN_PATHS_COLLECTOR;

const SESSIONE = {
  rawUrl: 'https://Esempio.IT/account/ordini?token=segreto#qui',
  rawSteps: [
    { selector: '#menu', action: 'click' },
    { selector: '[aria-label="Profilo di mario.rossi@x.it"]', action: 'click' },
  ],
  rawUserMessages: ['come disdico?'],
  success: true,
};

// I due LLM della pipeline: il primo propone l'intento, il secondo lo approva.
function invokeAIFinto({ risposteGuess = 'disdire l’abbonamento', judgeOk = true } = {}) {
  const visti = [];
  const fn = async ({ action, payload }) => {
    visti.push({ action, payload });
    if (action === ACTIONS.HELP_INTENT_GUESS) return { text: risposteGuess };
    if (action === ACTIONS.HELP_INTENT_JUDGE) return { text: JSON.stringify({ ok: judgeOk }) };
    return { text: '' };
  };
  fn.visti = visti;
  return fn;
}

function withFetch(fn) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null });
    return {
      ok: true,
      status: 200,
      json: async () => ({ name: 'projects/p/databases/(default)/documents/paths/esempio.it/entries/nuovo' }),
      text: async () => '{}',
    };
  };
  Collector._reset();
  Collector._setAuto(false);
  return fn(calls).finally(() => { globalThis.fetch = orig; Collector._reset(); });
}

// Un percorso non parte più nel momento in cui lo fai: entra in una coda e ne
// esce a un'ora sorteggiata più tardi (#584, vedi pathsRitardo.test.mjs). Qui
// interessa COSA parte, non quando: si porta l'orologio avanti oltre il
// ritardo massimo e si fa girare un giro di coda.
const OLTRE_IL_RITARDO = Collector._internal.RITARDO_MAX_MS + 60_000;
async function spedisci() {
  await Collector.flush({ now: Date.now() + OLTRE_IL_RITARDO });
}

test('quello che parte è il percorso e basta: nessun identificativo del mittente', async () => {
  await withFetch(async (calls) => {
    const r = await Collector.collectAndSave({ session: SESSIONE, invokeAI: invokeAIFinto() });
    assert.equal(r.saved, true, r.reason);
    assert.equal(calls.length, 0, 'il percorso non deve partire nell’istante in cui viene raccolto');
    await spedisci();
    assert.equal(calls.length, 1);

    const { url, body } = calls[0];
    assert.match(url, /\/paths\/esempio\.it\/entries\?/,
      'il percorso va scritto sotto il suo dominio: è quello che impedisce di leggerli tutti insieme');
    assert.deepEqual(Object.keys(body.fields).sort(),
      ['createdAt', 'initialUrl', 'intent', 'steps', 'success'].sort());

    // Il controllo che conta davvero: nella richiesta, dovunque, non deve
    // comparire niente che dica chi è stato.
    const grezzo = JSON.stringify(body);
    for (const spia of ['clientId', 'userAgent', 'Electron', 'Node/']) {
      assert.ok(!grezzo.includes(spia), `nella richiesta è comparso "${spia}"`);
    }
  });
});

test('della pagina esce il percorso, non la query: token e frammento restano a casa', async () => {
  await withFetch(async (calls) => {
    await Collector.collectAndSave({ session: SESSIONE, invokeAI: invokeAIFinto() });
    await spedisci();
    const { body } = calls[0];
    assert.equal(body.fields.initialUrl.stringValue, '/account/ordini');
    assert.ok(!JSON.stringify(body).includes('segreto'));
  });
});

test('i selettori che portano dati personali arrivano redatti', async () => {
  await withFetch(async (calls) => {
    await Collector.collectAndSave({ session: SESSIONE, invokeAI: invokeAIFinto() });
    await spedisci();
    const grezzo = JSON.stringify(calls[0].body);
    assert.ok(!grezzo.includes('mario.rossi@x.it'), 'un indirizzo email è finito nel percorso condiviso');
    assert.ok(grezzo.includes('[EMAIL]'));
  });
});

test('se il giudice dice no, non parte niente', async () => {
  await withFetch(async (calls) => {
    const r = await Collector.collectAndSave({
      session: SESSIONE, invokeAI: invokeAIFinto({ judgeOk: false }),
    });
    assert.equal(r.saved, false);
    assert.equal(calls.length, 0);
  });
});

test('una sessione senza dominio valido non scrive da nessuna parte', async () => {
  await withFetch(async (calls) => {
    const r = await Collector.collectAndSave({
      session: { ...SESSIONE, rawUrl: 'non-un-url' }, invokeAI: invokeAIFinto(),
    });
    assert.equal(r.saved, false);
    assert.equal(calls.length, 0);
  });
});

test('il giudice vede i messaggi grezzi, chi propone l’intento no', async () => {
  await withFetch(async () => {
    const invoke = invokeAIFinto();
    await Collector.collectAndSave({ session: SESSIONE, invokeAI: invoke });
    const guess = invoke.visti.find((v) => v.action === ACTIONS.HELP_INTENT_GUESS);
    const judge = invoke.visti.find((v) => v.action === ACTIONS.HELP_INTENT_JUDGE);
    assert.ok(!JSON.stringify(guess.payload).includes('come disdico'),
      'chi propone l’intento deve vedere solo i dati programmatici');
    assert.deepEqual(judge.payload.userMessages, ['come disdico?']);
  });
});

// ── La pagina di partenza (#584, terzo giro) ────────────────────────────────
//
// Senza queste guardie il percorso condiviso torna a dire chi l'ha fatto: un
// nome utente dentro l'indirizzo è lo stesso su più siti, quindi rimette
// insieme i percorsi di una persona meglio di quanto facesse il codice del
// mittente, e per di più le dà un nome.

test('dall’indirizzo di partenza spariscono nome utente e numero di conto', async () => {
  await withFetch(async (calls) => {
    await Collector.collectAndSave({
      session: { ...SESSIONE, rawUrl: 'https://forum-esempio.it/u/mario.rossi/ordini/847362' },
      invokeAI: invokeAIFinto(),
    });
    await spedisci();
    const partenza = calls[0].body.fields.initialUrl.stringValue;
    assert.equal(partenza, '/u/[ID]/ordini/[ID]');
    const grezzo = JSON.stringify(calls[0].body);
    assert.ok(!grezzo.includes('mario.rossi'), 'un nome utente è finito nel percorso condiviso');
    assert.ok(!grezzo.includes('847362'), 'un numero di conto è finito nel percorso condiviso');
  });
});

test('la sezione del sito resta leggibile: si toglie chi sei, non dove sei', () => {
  const { redactPath } = Collector._internal;
  assert.equal(redactPath('/account/ordini'), '/account/ordini');
  assert.equal(redactPath('/it/impostazioni/privacy'), '/it/impostazioni/privacy');
  assert.equal(redactPath('/'), '/');
  assert.equal(redactPath('/profilo/MarioRossi'), '/profilo/[ID]',
    'dopo un marcatore di persona il nome è scritto a lettere: lì non c’è forma che lo tradisca');
  assert.equal(redactPath('/messaggi/a/mario.rossi@posta.it'), '/messaggi/a/[EMAIL]');
  assert.equal(redactPath('/ordine/9f2c1b7a4e5d6c8b9a0f1e2d'), '/ordine/[ID]');
  assert.equal(redactPath('/impostazioni/privacit%C3%A0'), '/impostazioni/privacità',
    'una parola accentata arriva codificata: guardarla codificata la scambia per un codice');
  assert.equal(redactPath('/a/b%2Fc'), '/a/[ID]', 'un segmento che nasconde una barra non si tiene');
});

test('il giudice vede quello che verrebbe pubblicato, non solo la frase', async () => {
  await withFetch(async () => {
    const invoke = invokeAIFinto();
    await Collector.collectAndSave({ session: SESSIONE, invokeAI: invoke });
    const judge = invoke.visti.find((v) => v.action === ACTIONS.HELP_INTENT_JUDGE);
    assert.equal(judge.payload.initialUrl, '/account/ordini',
      'senza l’indirizzo davanti, il giudice approva un percorso che dice chi sei');
    assert.ok(Array.isArray(judge.payload.steps) && judge.payload.steps.length,
      'un nome di persona dentro l’etichetta di un pulsante lo ferma solo il giudice');
  });
});

test('nel prompt del giudice finiscono davvero indirizzo e selettori', () => {
  const p = globalThis.SN_CONST.PROMPTS.helpIntentJudge({
    proposedIntent: 'disdire l’abbonamento',
    userMessages: ['come disdico?'],
    initialUrl: '/u/[ID]/ordini',
    steps: [{ selector: '[aria-label="Profilo di Mario Rossi"]', action: 'click' }],
  });
  assert.ok(p.includes('/u/[ID]/ordini'), 'il giudice deve vedere la pagina di partenza');
  assert.ok(p.includes('Profilo di Mario Rossi'), 'il giudice deve vedere i nomi degli elementi');
  assert.match(p, /\[EMAIL\], \[NUMERO\] e \[ID\]/,
    'i segnaposto vanno dichiarati, o il giudice scarta i percorsi già ripuliti');
});

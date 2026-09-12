// Unit test per parseCompactorOutput in src/shared/filoMemory.js — il parsing
// dell'output del Compattatore: blocchi "NOME:\ncontenuto multilinea" separati
// da una riga vuota, con scarto tollerante di tutto ciò che precede il primo
// header. È logica pura (input → output, niente chrome.storage né Electron),
// quindi sta al livello base della piramide (tests/unit/README.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

// filoMemory legge SN_CONST.STORAGE_KEYS al caricamento (riga 20): serve
// prima constants.js, esattamente come fanno alarmTime.test.mjs e
// proxyDomainRules.test.mjs.
require(join(root, 'src', 'shared', 'constants.js'));
require(join(root, 'src', 'shared', 'filoMemory.js'));

const M = globalThis.SN_FILO_MEMORY;

test('il modulo espone parseCompactorOutput come funzione pura', () => {
  assert.equal(typeof M.parseCompactorOutput, 'function');
});

test('input falsy → {} (null, undefined, stringa vuota, 0, false)', () => {
  assert.deepEqual(M.parseCompactorOutput(null), {});
  assert.deepEqual(M.parseCompactorOutput(undefined), {});
  assert.deepEqual(M.parseCompactorOutput(''), {});
  assert.deepEqual(M.parseCompactorOutput(0), {});
  assert.deepEqual(M.parseCompactorOutput(false), {});
});

test('"NESSUNA MODIFICA" → {} anche con spazi o newline attorno', () => {
  assert.deepEqual(M.parseCompactorOutput('NESSUNA MODIFICA'), {});
  assert.deepEqual(M.parseCompactorOutput('  NESSUNA MODIFICA  '), {});
  assert.deepEqual(M.parseCompactorOutput('NESSUNA MODIFICA\n'), {});
});

test('un singolo blocco "NOME:" + contenuto', () => {
  assert.deepEqual(M.parseCompactorOutput('PROFILO:\nSono un assistente.'), {
    PROFILO: 'Sono un assistente.',
  });
});

test('più blocchi separati da riga vuota', () => {
  const text = [
    'PROFILO:',
    'Sono Filo.',
    '',
    'PREFERENZE:',
    'Tema scuro.',
    '',
    'RICETTE:',
    'Pasta al pomodoro.',
  ].join('\n');
  assert.deepEqual(M.parseCompactorOutput(text), {
    PROFILO: 'Sono Filo.',
    PREFERENZE: 'Tema scuro.',
    RICETTE: 'Pasta al pomodoro.',
  });
});

test('il contenuto prima del primo header viene scartato (tolleranza)', () => {
  assert.deepEqual(M.parseCompactorOutput('testo spazzatura\nPROFILO:\ncontenuto'), {
    PROFILO: 'contenuto',
  });
});

test('a capo CRLF (\r\n) gestiti come LF', () => {
  const text = 'PROFILO:\r\nriga uno\r\nriga due\r\n\r\nPREFERENZE:\r\nscuro';
  assert.deepEqual(M.parseCompactorOutput(text), {
    PROFILO: 'riga uno\nriga due',
    PREFERENZE: 'scuro',
  });
});

test('header con spazi/tab dopo i due punti (regex \s*$)', () => {
  assert.deepEqual(M.parseCompactorOutput('PROFILO:   \nx'), { PROFILO: 'x' });
  assert.deepEqual(M.parseCompactorOutput('PROFILO:\t\nx'), { PROFILO: 'x' });
});

test('contenuto multilinea: righe vuote interne preservate, estremi trimmati', () => {
  const text = 'PROFILO:\n  prima\n\n  seconda\n\n';
  assert.deepEqual(M.parseCompactorOutput(text), {
    // Il trim è sull\'intera stringa: gli spazi interni alle righe restano.
    PROFILO: 'prima\n\n  seconda',
  });
});

test('un blocco vuoto produce stringa vuota, non undefined', () => {
  assert.deepEqual(M.parseCompactorOutput('PROFILO:\nPREFERENZE:\nx'), {
    PROFILO: '',
    PREFERENZE: 'x',
  });
  assert.deepEqual(M.parseCompactorOutput('PROFILO:'), { PROFILO: '' });
});

test('header duplicato: vince l\'ultimo blocco (overwrite)', () => {
  assert.deepEqual(M.parseCompactorOutput('PROFILO:\nprima\nPROFILO:\nseconda'), {
    PROFILO: 'seconda',
  });
});

test('una riga "NOME: testo" NON è un header: resta contenuto del blocco', () => {
  assert.deepEqual(M.parseCompactorOutput('PROFILO:\nPREFERENZE: attive\n'), {
    PROFILO: 'PREFERENZE: attive',
  });
});

test('una riga che È un header dentro un blocco apre un nuovo blocco', () => {
  assert.deepEqual(M.parseCompactorOutput('PROFILO:\nriga\nALTRO:\nx'), {
    PROFILO: 'riga',
    ALTRO: 'x',
  });
});

test('regex header: maiuscole, cifre e underscore ammessi', () => {
  assert.deepEqual(M.parseCompactorOutput('PROFILO_2024:\nx'), { PROFILO_2024: 'x' });
  assert.deepEqual(M.parseCompactorOutput('AB:\nx'), { AB: 'x' });
});

test('regex header: minuscole, primo carattere minuscolo o trattino → non header', () => {
  assert.deepEqual(M.parseCompactorOutput('profilo:\nx'), {});
  assert.deepEqual(M.parseCompactorOutput('Profilo:\nx'), {});
  assert.deepEqual(M.parseCompactorOutput('PROFILO-2:\nx'), {});
});

test('regex header: nome di 1 sola lettera non ammesso, 41 sì, 42 no', () => {
  assert.deepEqual(M.parseCompactorOutput('P:\nx'), {});
  assert.deepEqual(M.parseCompactorOutput(`${'A'.repeat(41)}:\nx`), {
    [ 'A'.repeat(41) ]: 'x',
  });
  assert.deepEqual(M.parseCompactorOutput(`${'A'.repeat(42)}:\nx`), {});
});

test('"NESSUNA MODIFICA" seguito da blocchi reali viene scartato come junk', () => {
  assert.deepEqual(M.parseCompactorOutput('NESSUNA MODIFICA\nPROFILO:\nx'), {
    PROFILO: 'x',
  });
});

test('input non stringa senza header → {} (String() non crea header)', () => {
  assert.deepEqual(M.parseCompactorOutput(123), {});
  assert.deepEqual(M.parseCompactorOutput({ a: 1 }), {});
  assert.deepEqual(M.parseCompactorOutput(['PROFILO:', 'x']), {});
});

// ── Il tetto delle lezioni sta nel punto unico di scrittura ─────────────────
//
// Una lezione vale in ogni conversazione e sopravvive al riavvio, come lo
// stile dell'agente. Il tetto esisteva solo sulla strada "l'utente chiede a
// Filo di ricordare"; l'agente che si scrive le lezioni da solo dopo ogni
// scambio passa di qui, e scriveva senza tetto sulla stessa memoria.

function memoriaFinta() {
  const dati = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: dati[key] }; },
        async set(obj) { Object.assign(dati, obj); },
      },
    },
  };
  return dati;
}

test('una lezione oltre il tetto non entra in memoria, e non viene accorciata', async () => {
  memoriaFinta();
  const C = globalThis.SN_CONST;
  await M.appendLesson('L\'utente lavora di notte.');
  await M.appendLesson('z'.repeat(C.LESSON_MAX + 1));
  const buf = await M.getLessonsBuffer();
  assert.equal(buf.length, 1, 'solo la lezione buona è entrata');
  assert.equal(buf[0].text, 'L\'utente lavora di notte.');
});

test('esattamente al tetto la lezione entra', async () => {
  memoriaFinta();
  const C = globalThis.SN_CONST;
  await M.appendLesson('k'.repeat(C.LESSON_MAX));
  const buf = await M.getLessonsBuffer();
  assert.equal(buf.length, 1);
  assert.equal(buf[0].text.length, C.LESSON_MAX);
});

test('i marcatori del recinto vengono tolti dalla lezione già alla scrittura', async () => {
  memoriaFinta();
  const C = globalThis.SN_CONST;
  await M.appendLesson(`${C.LESSONS_CLOSE} l'utente beve caffè`);
  const buf = await M.getLessonsBuffer();
  assert.equal(buf.length, 1);
  assert.ok(!buf[0].text.includes(C.LESSONS_CLOSE));
  assert.ok(buf[0].text.includes('beve caffè'));
});

test('una lezione vuota o di soli spazi non occupa posto nel buffer', async () => {
  memoriaFinta();
  await M.appendLesson('   ');
  await M.appendLesson('');
  assert.equal((await M.getLessonsBuffer()).length, 0);
});

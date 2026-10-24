// I file di prova che leggono la sessione restano verdi anche lanciati da soli con `node --test` dentro una sessione
// vera, routine o locale: il lanciatore degli unit toglie l'identità (#949.1), chi corre un file a mano no (#1109.1).
// La regola sta in tests/helpers/senzaSessione.mjs.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITA_SESSIONE, fileArgs, flagsConAvanzamento, lanciaSorvegliato, testoFermo, testoFileChiusi } from '../../scripts/run-unit-tests.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(QUI, '..', '..');
const QUESTO = basename(fileURLToPath(import.meta.url));
// Quelli che lanciati da soli in una sessione erano rossi: se uno perde l'import del helper, la prova lo rivede rosso.
const NOTI = ['dispatch', 'domandaChiusura', 'esitoPerCommit', 'routineChannelRilascio', 'routineRole', 'routineTicket', 'sessionReport']
  .map((n) => `${n}.test.mjs`);
const IMPORTA = /^import '\.\.\/helpers\/senzaSessione\.mjs';$/m;
let corse = 0;

/**
 * Decine di file sotto carico durano quanto vuole la macchina: il tetto conta il tempo in cui niente va avanti, come nel
 * lanciatore, non la durata della corsa (#1214). `fermo` è il rosso col nome del file e il tempo, o null.
 */
async function daSoli(file, sessione, { casa, tetto = TETTO_ATTESA_MS }) {
  // Con NODE_TEST_CONTEXT il figlio si crederebbe una sotto-prova di questa e non correrebbe niente.
  const { NODE_TEST_CONTEXT: _figlio, ...ambiente } = process.env;
  const avanzamento = join(casa, `avanzamento-${++corse}.jsonl`);
  const r = await lanciaSorvegliato(['--test', ...flagsConAvanzamento(['--test-reporter=tap'], avanzamento), ...fileArgs(file, ROOT)], {
    env: { ...ambiente, ...sessione }, avanzamento, tetto, raccogli: true,
  });
  // Gli avvisi del lanciatore, tutti: un file fermo lo chiude da solo il tetto per file (#1231), la corsa ferma dice chi.
  const avvisi = [r.chiusi?.length && testoFileChiusi(r.chiusi, tetto), r.fermo && testoFermo(r.fermo, tetto)].filter(Boolean);
  return { ...r, fermo: avvisi.length ? avvisi.join('\n') : null };
}

test('lanciati da soli in una sessione con tutta la sua identità accesa, i file che la leggono sono verdi (#1109.1)', async () => {
  const importano = readdirSync(QUI).filter((f) => f.endsWith('.test.mjs') && f !== QUESTO && IMPORTA.test(readFileSync(join(QUI, f), 'utf8')));
  const file = [...new Set([...NOTI, ...importano])];
  const casa = cartellaTemporanea('filo-prove-da-sole-');
  try {
    // Un transcript con un consumo vero: è quello che finiva nei corpi confrontati e nelle cartelle di prova.
    const sid = 'sessione-che-lancia-le-prove';
    const transcript = join(casa, `${sid}.jsonl`);
    const uso = { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 5600, cache_creation_input_tokens: 78 };
    writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-4-8', usage: uso } })}\n`, 'utf8');
    const sessione = {
      FILO_ROUTINE: '1', FILO_ROUTINE_ROLE: 'verifier', FILO_ROUTINE_TICKET: 'biglietto-della-sessione-vera',
      FILO_TRANSCRIPT: transcript, FILO_SESSION_ID: sid,
    };
    assert.deepEqual(Object.keys(sessione).sort(), [...IDENTITA_SESSIONE].sort(), 'ogni voce dell\'identità della sessione è accesa');
    const r = await daSoli(file.map((f) => join(QUI, f)), sessione, { casa });
    assert.equal(r.fermo, null, r.fermo);
    const rossi = r.stdout.match(/^\s*not ok .*$/gm) || [];
    assert.equal(r.status, 0, rossi.join('\n') || String(r.stderr || r.error || '').slice(-4000));
    assert.match(r.stdout, /^# fail 0$/m);
  } finally {
    togliCartella(casa);
  }
});

test('la corsa va avanti oltre il tetto finché avanza; ferma, è un rosso col nome del file e il tempo (#1214)', async () => {
  const casa = cartellaTemporanea('filo-prove-da-sole-tetto-');
  try {
    // Dieci passi da 400 ms in fila durano più del tetto, e nessuno lo sfiora: un tetto sulla durata la taglierebbe.
    const tetto = 3000;
    const lento = join(casa, 'lento.test.mjs');
    writeFileSync(lento, "import { test } from 'node:test';\nfor (let i = 0; i < 10; i++) test(`passo ${i}`, () => new Promise((r) => setTimeout(r, 400)));\n");
    const r = await daSoli([lento], {}, { casa, tetto });
    assert.equal(r.fermo, null, r.fermo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal((r.stdout.match(/^ok \d+ - passo \d$/gm) || []).length, 10, r.stdout);

    const fermo = join(casa, 'fermo.test.mjs');
    writeFileSync(fermo, "import { test } from 'node:test';\ntest('prima di fermarsi', () => {});\nsetInterval(() => {}, 1000);\n");
    const f = await daSoli([fermo], {}, { casa, tetto });
    assert.match(String(f.fermo), /fermo\.test\.mjs non è andato avanti per 3 secondi/);
    assert.notEqual(f.status, 0);
  } finally {
    togliCartella(casa);
  }
});

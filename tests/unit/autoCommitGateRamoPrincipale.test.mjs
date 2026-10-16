// Le prove degli agganci di salvataggio stanno in più file perché girino in parallelo (#1063): la scena comune
// e il racconto della regola sono in tests/helpers/scenaHook.mjs e in tests/unit/autoCommitGate.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ROOT, HOOKS, git, scene, runHook, runHookStderr, runHookRaw, rigaJson, LIMITE, shaOf, filesOnMain, commitFile,
} from '../helpers/scenaHook.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Il ramo principale non si tocca: né si committa, né si spedisce
//
// La protezione vera sta su GitHub (sul ramo principale scrive solo l'identità
// del server, e un push da questa macchina viene RESPINTO). Ma un automatismo
// che tenta e viene respinto in silenzio è un guasto invisibile — è già
// successo: un ramo che non si salvava più da giorni senza che nessuno lo
// sapesse. E una difesa che dipende da un solo muro cade con quel muro.
// ─────────────────────────────────────────────────────────────────────────────

describe('gli automatismi si astengono sul ramo principale', () => {
  test('il salvataggio NON committa sul ramo principale, e le modifiche restano dove sono', () => {
    const { work } = scene();
    const prima = shaOf(work, 'main');
    writeFileSync(resolve(work, 'non-esaminato.js'), 'codice mai esaminato\n', 'utf8');

    runHook(work);

    assert.equal(shaOf(work, 'main'), prima,
      'un lavoro fatto sul ramo principale non ha modo di arrivare agli utenti: non deve nemmeno essere committato lì');
    assert.match(git(work, ['status', '--porcelain']), /non-esaminato\.js/,
      'astenersi non vuol dire buttare via: la modifica deve restare nella cartella, pronta da spostare su un ramo di lavoro');
  });

  test("il salvataggio NON spedisce il ramo principale, nemmeno con FILO_MAIN_BRANCH avvelenata", () => {
    // La guardia stava appesa a una variabile d'ambiente
    // (`TARGET_BRANCH="${FILO_MAIN_BRANCH:-main}"`): bastava esportarne una
    // perché "sei sul ramo principale" diventasse falso, e il passo che
    // spedisce spedisse il ramo principale. A ogni singola modifica.
    const { work, origin } = scene({ poison: true });
    const prima = git(origin, ['rev-parse', 'main']);
    writeFileSync(resolve(work, 'dirottato.js'), 'x\n', 'utf8');

    runHook(work, { FILO_MAIN_BRANCH: 'un-ramo-che-non-esiste' });

    assert.equal(git(origin, ['rev-parse', 'main']), prima,
      'il nome del ramo principale non si prende dall\'ambiente quando serve a decidere una guardia');
  });

  test('il diagnostico dei limiti NON spedisce il ramo principale, e non ci committa sopra', () => {
    const { work, origin } = scene({ poison: true });
    const primaLocale = shaOf(work, 'main');
    const primaOrigin = git(origin, ['rev-parse', 'main']);

    runHook(work, {}, 'cap-observe.sh', LIMITE);

    assert.equal(git(origin, ['rev-parse', 'main']), primaOrigin,
      'spediva il ramo corrente senza chiedersi quale fosse: sul ramo principale non si spedisce');
    assert.equal(shaOf(work, 'main'), primaLocale,
      'e nemmeno ci si committa sopra');
  });

  test('il diagnostico si astiene ma la nota NON si perde: resta scritta nella cartella', () => {
    const { work } = scene();

    runHook(work, {}, 'cap-observe.sh', LIMITE);

    const nota = readFileSync(resolve(work, '.claude', 'cap-observations.jsonl'), 'utf8');
    assert.match(nota, /usage_limit/,
      'il motivo per cui questo hook esiste è registrare che una sessione è stata tagliata: astenersi dal git non deve cancellare l\'osservazione');
  });
});

describe('…ma su un ramo di lavoro continuano a fare il loro mestiere', () => {
  test('il salvataggio committa E spedisce: la punta locale e quella su origin coincidono', () => {
    // È l'assert che protegge dal rimedio peggiore del male: una guardia
    // scritta larga che smette di salvare anche il lavoro vero.
    const { work } = scene({ poison: true });
    git(work, ['checkout', '-q', '-b', 'claude/lavoro']);
    writeFileSync(resolve(work, 'importante.js'), 'da non perdere\n', 'utf8');

    runHook(work);

    assert.equal(git(work, ['status', '--porcelain']), '', 'il lavoro deve essere salvato');
    git(work, ['fetch', '-q', 'origin', 'claude/lavoro']);
    assert.equal(shaOf(work, 'origin/claude/lavoro'), shaOf(work, 'claude/lavoro'),
      'il trasporto del lavoro: se il ramo non arriva su origin, verifica e server guardano una versione vecchia');
  });

  test('HEAD staccata: il paracadute locale resta (si committa, non si spedisce)', () => {
    // La guardia riguarda LA LINEA PRINCIPALE, non "tutto ciò che non è un ramo
    // di lavoro". Le cartelle a HEAD staccata sono la forma che usano le
    // sessioni isolate: lì il commit locale è l'unica rete che hanno, e
    // toglierla sarebbe un rimedio peggiore del male. Spedire invece non si
    // può: non c'è nessun ramo dove far atterrare il lavoro.
    const { work } = scene();
    const staccato = git(work, ['rev-parse', 'HEAD']);
    git(work, ['checkout', '-q', '--detach', staccato]);
    writeFileSync(resolve(work, 'sessione-isolata.js'), 'x\n', 'utf8');

    runHook(work);

    assert.equal(git(work, ['status', '--porcelain']), '',
      'una sessione interrotta di colpo non deve perdere il lavoro nemmeno a HEAD staccata');
    assert.notEqual(git(work, ['rev-parse', 'HEAD']), staccato, 'il commit deve esserci');
    assert.equal(shaOf(work, 'origin/main'), staccato,
      'e non deve essere finito sul ramo principale di origin');
  });

  test('il diagnostico registra E spedisce il suo ramo', () => {
    const { work } = scene({ poison: true });
    git(work, ['checkout', '-q', '-b', 'claude/diagnostica']);

    runHook(work, {}, 'cap-observe.sh', LIMITE);

    git(work, ['fetch', '-q', 'origin', 'claude/diagnostica']);
    assert.equal(shaOf(work, 'origin/claude/diagnostica'), shaOf(work, 'claude/diagnostica'),
      'in cloud il container è effimero: se l\'osservazione non arriva su origin, al giro dopo non esiste più');
    assert.match(git(work, ['show', '--name-only', '--format=', 'HEAD']), /cap-observations\.jsonl/,
      'l\'osservazione deve essere finita nel commit, non solo nella cartella');
  });
});

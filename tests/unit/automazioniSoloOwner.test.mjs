// Sentinella del #1140: le automazioni (.github/workflows) le cambia solo l'owner. Le routine lo leggono nei ruoli, il
// controllo di sicurezza lo boccia, e il no di GitHub a una credenziale senza quel permesso arriva a chi spinge con cosa
// fare, non come un push da ritentare. Il racconto: patterns/le-automazioni-le-cambia-solo-l-owner.md.

import '../helpers/senzaSessione.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { git, scene, runHookRaw, rigaJson, ROOT } from '../helpers/scenaHook.mjs';
import { rifiutoAutomazioni } from '../../scripts/finish-local.mjs';

const { readRoleInstructions } = await import('../../scripts/dispatch.mjs');
const piatto = (s) => s.replace(/\s+/g, ' ');
const PATTERN = 'patterns/le-automazioni-le-cambia-solo-l-owner.md';

// Le tre forme del no di GitHub: token OAuth (gh, Git Credential Manager), token personale, App.
const NO_DI_GITHUB = [
  " ! [remote rejected] claude/x -> claude/x (refusing to allow an OAuth App to create or update workflow `.github/workflows/a.yml` without `workflow` scope)",
  " ! [remote rejected] claude/x -> claude/x (refusing to allow a Personal Access Token to create or update workflow `.github/workflows/a.yml` without `workflow` scope)",
  " ! [remote rejected] claude/x -> claude/x (refusing to allow a GitHub App to create or update workflow `.github/workflows/a.yml` without `workflows` permission)",
];

describe('npm run finish: il no sulle automazioni dice di spingere a mano', () => {
  test('le tre forme del no di GitHub danno la riga che rimanda alla credenziale delle automazioni', () => {
    for (const no of NO_DI_GITHUB) {
      const riga = rifiutoAutomazioni(`To https://github.com/sathyaram1/Filo\n${no}\nerror: failed to push some refs`);
      assert.match(riga, /Spingilo a mano con quella delle automazioni/, no);
      assert.ok(riga.includes(PATTERN), 'la riga porta dove stanno i passi');
    }
  });

  test('un altro no del remoto, o nessuna uscita, non la danno', () => {
    assert.equal(rifiutoAutomazioni(' ! [remote rejected] claude/x -> claude/x (push declined due to repository rule violations)'), '');
    assert.equal(rifiutoAutomazioni(''), '');
    assert.equal(rifiutoAutomazioni(undefined), '');
  });
});

describe('il salvataggio automatico: il no sulle automazioni arriva alla sessione per quello che è', () => {
  test('GitHub rifiuta il cambio a un\'automazione: il contesto dice che è voluto, a chi tocca e di fermarsi, non di rispedire', () => {
    const { origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/automazione']);
    const f = resolve(origin, 'hooks', 'pre-receive');
    writeFileSync(f, '#!/bin/sh\nprintf "refusing to allow an OAuth App to create or update workflow `.github/workflows/a.yml` without `workflow` scope\\n" >&2\nexit 1\n', 'utf8');
    chmodSync(f, 0o755);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');

    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse' }));

    assert.equal(r.status, 0);
    const contesto = JSON.parse(rigaJson(r)).hookSpecificOutput.additionalContext;
    assert.match(contesto, /claude\/automazione' NON e' arrivato su origin: porta un cambio alle automazioni/);
    assert.ok(contesto.includes(PATTERN), 'il contesto porta dove sta la regola');
    assert.match(contesto, /in una routine il lavoro va ai lavori locali, in locale il ramo lo spinge lui a mano/);
    assert.match(contesto, /create or update workflow/, 'col motivo di GitHub');
    assert.match(contesto, /Fermati e dillo all'owner/);
    assert.doesNotMatch(contesto, /sistemalo prima di consegnare|git push del ramo/, 'un push da qui viene rifiutato allo stesso modo: non si suggerisce');
    assert.equal(git(work, ['ls-remote', origin, 'refs/heads/claude/automazione']), '', 'origin non ha preso niente');
  });
});

describe('le istruzioni dicono la regola dove serve', () => {
  test('chi scrive codice nelle routine sa che un file delle automazioni non si scrive e il lavoro va in locale', () => {
    for (const [ruolo, opts] of [['new-work', {}], ['fixer', {}], ['fixer', { caso: 'ripresa' }], ['fixer', { caso: 'riallineamento' }]]) {
      const t = piatto(readRoleInstructions(ruolo, opts));
      const locale = t.slice(t.indexOf('## Se il lavoro si fa solo in locale'));
      assert.match(locale, /toccare le automazioni GitHub \(`\.github\/workflows`, di Filo e del server\)/, `${ruolo} ${JSON.stringify(opts)}`);
      assert.match(locale, /le cambia solo l'owner, e un file lì dentro non si scrive e non si spinge nemmeno quando la spinta passerebbe/, `${ruolo} ${JSON.stringify(opts)}`);
    }
  });

  test('il controllo di sicurezza boccia un diff che tocca le automazioni', () => {
    assert.match(piatto(readRoleInstructions('secaudit', {})), /Un file toccato in `\.github\/workflows` è `fail` da solo/);
  });

  test('il documento comune ha la regola e rimanda al racconto', () => {
    const comune = piatto(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8'));
    assert.match(comune, /Le automazioni \(`\.github\/workflows`\) le cambia solo l'owner/);
    assert.ok(comune.includes(PATTERN));
  });
});

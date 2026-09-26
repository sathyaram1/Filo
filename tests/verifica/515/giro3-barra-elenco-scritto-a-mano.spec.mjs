// Verifica #515 — giro 3.
//
// La segnalazione nasce da un elenco di documenti ricopiato a mano che aveva
// smesso di corrispondere ai documenti veri. Questo lavoro ha derivato l'elenco
// che parte verso il fornitore. Qui si prova l'altro elenco: quello che decide
// cosa compare nella barra della pagina, dentro Filo e sul sito.
//
// Perché conta: è l'unica strada per RAGGIUNGERE un documento sfogliando. Se un
// documento scritto non ci finisce dentro, esiste ma non lo trova nessuno.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('un documento nuovo compare nella barra della trasparenza', () => {
  // Si lavora su una copia: la generazione scrive nel repo, e questa prova non
  // deve lasciare traccia.
  const tmp = cartellaTemporanea('filo-trasparenza-');
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'build-transparency.mjs'), join(tmp, 'scripts', 'build-transparency.mjs'));
  cpSync(join(ROOT, 'transparency'), join(tmp, 'transparency'), { recursive: true });
  mkdirSync(join(tmp, 'src', 'styles'), { recursive: true });
  cpSync(join(ROOT, 'src', 'styles', 'transparency.css'), join(tmp, 'src', 'styles', 'transparency.css'));

  // L'owner scrive un documento nuovo, su un tema che nessuno aveva previsto.
  writeFileSync(join(tmp, 'transparency', 'dati.md'), [
    '---',
    'id: dati',
    'title: I tuoi dati',
    'subtitle: Dove finiscono i dati di chi usa Filo.',
    'updated: 2026-09-22',
    'order: 5',
    '---',
    '',
    'Filo tiene i tuoi dati sul tuo computer.',
    '',
    '## Cosa esce da qui',
    '',
    'Solo quello che chiedi tu.',
    '',
  ].join('\n'), 'utf8');

  execFileSync(process.execPath, [join(tmp, 'scripts', 'build-transparency.mjs')], { encoding: 'utf8' });

  const modulo = readFileSync(join(tmp, 'src', 'shared', 'transparency.js'), 'utf8');
  expect(modulo, 'il documento nuovo non è nemmeno stato generato: la prova non prova niente')
    .toContain('I tuoi dati');

  const paginaSua = join(tmp, 'site', 'transparency', 'dati.html');
  expect(existsSync(paginaSua), 'il documento nuovo non ha una pagina').toBe(true);

  // La barra è la stessa su tutte le pagine: se il documento non c'è, non lo
  // raggiunge chi sfoglia, né dentro Filo né sul sito.
  const barra = readFileSync(join(tmp, 'site', 'transparency', 'models.html'), 'utf8')
    .split('<nav class="sn-nav">')[1].split('</nav>')[0];
  expect(barra, 'un documento scritto non compare nella barra: nessuno lo raggiunge sfogliando')
    .toContain('I tuoi dati');
});

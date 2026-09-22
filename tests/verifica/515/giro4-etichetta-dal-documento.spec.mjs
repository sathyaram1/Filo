// Verifica #515 — giro 4.
//
// La barra non è più un elenco fisso: un documento su un tema non previsto ci
// entra da solo. Resta però scritto a mano COME si chiamano le quattro aree
// annunciate, e quel nome vince sul nome che il documento si dà.
//
// Perché conta: il giorno in cui l'owner scrive una di quelle sezioni, il nome
// corto che le mette in testa al documento non arriva mai nella barra, e niente
// glielo dice.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('il nome che un documento si dà arriva nella barra anche nelle aree annunciate', () => {
  const tmp = cartellaTemporanea('filo-trasparenza-');
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'scripts', 'build-transparency.mjs'), join(tmp, 'scripts', 'build-transparency.mjs'));
  cpSync(join(ROOT, 'transparency'), join(tmp, 'transparency'), { recursive: true });
  mkdirSync(join(tmp, 'src', 'styles'), { recursive: true });
  cpSync(join(ROOT, 'src', 'styles', 'transparency.css'), join(tmp, 'src', 'styles', 'transparency.css'));

  // L'owner scrive finalmente la sezione sui dati, e le dà un nome suo.
  writeFileSync(join(tmp, 'transparency', 'privacy.md'), [
    '---',
    'id: privacy',
    'title: Dove finiscono i tuoi dati',
    'nav: I tuoi dati',
    'subtitle: Cosa esce dal tuo computer, e verso chi.',
    'updated: 2026-09-22',
    'order: 2',
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
  expect(modulo, 'il documento non è stato generato: la prova non prova niente')
    .toContain('Dove finiscono i tuoi dati');

  const barra = readFileSync(join(tmp, 'site', 'transparency', 'models.html'), 'utf8')
    .split('<nav class="sn-nav">')[1].split('</nav>')[0];
  expect(barra, 'la barra tiene il nome scritto a mano e butta via quello del documento')
    .toContain('I tuoi dati');
});

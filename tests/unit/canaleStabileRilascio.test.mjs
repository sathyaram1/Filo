// La minor del canale stabile nel lavoro di pubblicazione (SPEC-DOMANDE.md §4.2): la chiede ogni corsa, la corsa del
// lunedì non pubblica una patch al suo posto, e il numero lo chiede lo script di QUESTA corsa, non quello del commit
// provato (che può non sapere cos'è una minor: farebbe una patch).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const YML = readFileSync(resolve(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');
const COMANDI = senzaCommenti(YML);

function job(nome) {
  const inizio = YML.search(new RegExp(`^\\s{2}${nome}:\\s*$`, 'm'));
  assert.ok(inizio >= 0, `manca il job ${nome}`);
  const resto = YML.slice(inizio + 1);
  const fine = resto.search(/^\s{2}[a-z][\w-]*:\s*$/m);
  return senzaCommenti(fine >= 0 ? YML.slice(inizio, inizio + 1 + fine) : YML.slice(inizio));
}

const CRON_STABILE = [...COMANDI.matchAll(/- cron: '([^']+)'/g)].map((m) => m[1]).find((c) => c !== '0 */6 * * *');

test('c’è un secondo cron, e una delle sue ore è la mezzanotte del lunedì a Roma con e senza ora legale', () => {
  assert.ok(CRON_STABILE, 'manca il cron del canale stabile');
  const m = CRON_STABILE.match(/^0 (\d+(?:,\d+)*) \* \* 0$/);
  assert.ok(m, `il cron della minor è di domenica, a ore piene UTC: ${CRON_STABILE}`);
  const ore = m[1].split(',').map(Number);
  const roma = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  // Una domenica d'estate e una d'inverno.
  for (const domenica of ['2026-07-12', '2026-11-08']) {
    const mezzanotte = ore.some((h) => {
      const p = Object.fromEntries(roma.formatToParts(new Date(`${domenica}T${String(h).padStart(2, '0')}:00:00Z`)).map((x) => [x.type, x.value]));
      return p.weekday === 'Mon' && p.hour === '00';
    });
    assert.ok(mezzanotte, `la domenica ${domenica} nessuna corsa cade alle 00 di lunedì a Roma`);
  }
});

test('`scegli` chiede al server se la minor è dovuta, e la corsa della minor non sceglie una patch', () => {
  const scegli = job('scegli');
  assert.match(scegli, /id:\s*minor\b/);
  assert.match(scegli, /node scripts\/release-bump\.mjs --controlla-minor/);
  assert.match(scegli, /outputs:\s*\n\s*sha:[^\n]+\n\s*stabile:\s*\$\{\{\s*steps\.minor\.outputs\.stabile\s*\}\}/);
  const se = scegli.match(/id:\s*scelta\s*\n\s*if:\s*(.+)/);
  assert.ok(se, 'la scelta del commit ha la sua condizione');
  assert.ok(se[1].includes(`github.event.schedule != '${CRON_STABILE}'`), 'la stringa del cron è la stessa dell’intestazione');
  assert.match(se[1], /steps\.minor\.outputs\.stabile == 'true'/);
  assert.match(scegli, /ultima-suite-verde\.mjs \$\(\[ "\$STABILE" = "true" \] && echo --stabile\)/);
});

test('la minor esce anche senza codice nuovo, e il numero lo chiede lo script di questa corsa', () => {
  const r = job('release');
  const check = r.slice(r.indexOf('id: check'), r.indexOf('- name: Install dipendenze'));
  const forza = check.indexOf('needs.scegli.outputs.stabile }}" = "true"');
  assert.ok(forza > 0, 'il controllo «c’è qualcosa di nuovo» lascia passare la minor');
  assert.ok(forza > check.indexOf('"$QUI" != "$PROVATO"'), 'mai prima del controllo sul commit provato');
  const bump = r.slice(r.indexOf('id: bump'), r.indexOf('- name: Applica il numero'));
  assert.match(bump, /git show "\$\{GITHUB_SHA\}:scripts\/release-bump\.mjs"/);
  assert.match(bump, /git show "\$\{GITHUB_SHA\}:scripts\/build-alarm\.mjs"/, 'lo script importa build-alarm: senza, la copia non parte');
  assert.match(bump, /release-bump\.mjs" --minor\)/);
  assert.match(bump, /VERSION=\$\(node scripts\/release-bump\.mjs\)/, 'il veloce resta com’era');
});

test('le importazioni dello script del numero sono quelle che la corsa copia', () => {
  const src = readFileSync(resolve(ROOT, 'scripts', 'release-bump.mjs'), 'utf8');
  const locali = [...src.matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(locali, ['./build-alarm.mjs']);
  const alarm = readFileSync(resolve(ROOT, 'scripts', 'build-alarm.mjs'), 'utf8');
  assert.deepEqual([...alarm.matchAll(/from '(\.\/[^']+)'/g)], [], 'build-alarm non importa altri file del repo');
});

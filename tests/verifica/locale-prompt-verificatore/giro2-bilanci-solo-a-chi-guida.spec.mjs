// Prova del giro 2: quanti giri di correzione restano per ogni livello non
// deve arrivare a chi verifica PRIMA che la critica sia scritta — è
// l'informazione che decide se un rilievo verrà corretto o finirà nel report,
// quindi orienta il livello proprio mentre lo si sceglie.
//
// Il compito consegnato è già pulito (giro 1). Resta aperta l'altra porta: lo
// strumento della verifica, chiesto in che stato è, apre la risposta con quei
// numeri. È il primo gesto di chi prende in mano uno strumento nuovo, e la
// schermata di aiuto quel comando lo nomina.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function lancia(args) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'verify-local.mjs'), ...args],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { out, err: '' };
  } catch (e) {
    return { out: String(e.stdout || ''), err: String(e.stderr || '') };
  }
}

test('chiedere in che stato è il giro non rivela quanti giri di correzione restano', () => {
  const { out, err } = lancia(['status']);
  test.skip(/FILO_ADMIN_REFRESH_TOKEN/.test(err) && !out.trim(),
    'senza il token dell\'owner i bilanci non si leggono affatto: qui non si prova niente');
  expect(out, 'lo stato del giro non deve nominare i bilanci residui: chi verifica legge di lì').not.toMatch(/cap2|cap1|cap0/i);
  expect(out, 'nemmeno la parola «bilanci» con dei numeri accanto').not.toMatch(/bilanc/i);
});

test('la schermata di aiuto non promette i bilanci a chi la apre', () => {
  const { out, err } = lancia(['--help']);
  const testo = out + err;
  expect(testo).toContain('Comandi:');
  expect(testo, 'l\'aiuto non deve indicare dove si leggono i bilanci del giro').not.toMatch(/bilanc|cap2/i);
});

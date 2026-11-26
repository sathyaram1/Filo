// Verifica #1403.42 giro 1: una password dichiarata in un'altra lingua col nome precisato dopo («contraseña temporal»,
// «mot de passe provisoire») entra fra i letti come la sua forma italiana («la password provvisoria è …»).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const f of ['cmdClassify.js', 'actionLevels.js', 'guardianoStatico.js', 'urlExfil.js']) require(join(ROOT, 'src', 'shared', f));
const G = globalThis.SN_GUARDIANO_STATICO;

const ITALIANE = ['La tua password provvisoria è Gatto2024', 'La password di accesso è Gatto2024'];
const ALTRE = [
  'Su contraseña temporal es Gatto2024',
  'Su contraseña de acceso es Gatto2024',
  'Votre mot de passe provisoire est Gatto2024',
  'Votre mot de passe initial est Gatto2024',
  'A sua senha de acesso é Gatto2024',
  'Twoje hasło tymczasowe to Gatto2024',
  'Ihr Passwort für den ersten Zugang lautet Gatto2024',
];

test('r1 la password col nome precisato dopo si riconosce in ogni lingua come in italiano', () => {
  const trovata = (f) => G.segretiNelTesto(f).some((x) => x.valore === 'Gatto2024' && x.regola === 'password');
  expect(ITALIANE.filter((f) => !trovata(f))).toEqual([]);
  expect(ALTRE.filter((f) => !trovata(f))).toEqual([]);
});

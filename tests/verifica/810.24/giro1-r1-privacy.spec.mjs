// Verifica #810.24 giro 1, r1: la pagina della privacy dice cosa resta su disco di quello che l'utente scrive.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

test('r1 la pagina della privacy nomina tutto quello di cui resta l’impronta, e non la dice irreversibile', () => {
  require(join(RADICE, 'src', 'shared', 'guardianoStatico.js'));
  const SL = require(join(RADICE, 'src', 'main', 'services', 'segretiLetti.js'));
  let salvato = null;
  SL.usaDeposito({ leggi: () => salvato, scrivi: (t) => { salvato = t; } });
  const password = 'Zq7#mR42kLp';
  SL.immessoDallUtente('1:1-1:1', `Ciao Luca, la password: ${password} per il wifi.`);
  SL.svuota();
  const voci = JSON.parse(salvato || '[]');
  const sale = (voci.find((x) => x.sale) || {}).sale;
  const impronte = new Set(voci.filter((x) => x.suo).map((x) => x.suo));
  // Il valore a caso sta nello stesso file: chi ha il file ritrova la password provando un elenco di candidate.
  const ritrovata = ['password', 'Ciao2024', password.toLowerCase()].find((c) =>
    impronte.has(createHash('sha256').update(`${sale}\u0000${c}`).digest('hex').slice(0, 32)));
  expect(ritrovata, 'la password scritta non lascia un’impronta').toBe(password.toLowerCase());
  SL.usaDeposito(null);

  const testo = readFileSync(join(RADICE, 'transparency', 'privacy-completa.md'), 'utf8');
  const frase = testo.split(/(?<=\.)\s+/).find((f) => /scrivi tu in una pagina/.test(f) && /impronta/.test(f)) || '';
  expect(frase, 'la frase sulle impronte di quello che scrivi non c’è').not.toBe('');
  expect(frase, 'la privacy non dice che restano anche le password').toMatch(/password/i);
  expect(frase, 'la privacy non dice che restano anche i codici').toMatch(/codic/i);
  expect(frase, 'la privacy presenta l’impronta come più sicura del valore').not.toMatch(/solo un'impronta/);
});

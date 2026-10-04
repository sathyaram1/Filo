// Giro 5, rilievo 2: la cartella data al verificatore per i suoi appunti non è quella dove il lavoratore ha lasciato le sue note.
import { test, expect } from '@playwright/test';
import { promptLavoratore, promptVerificatore, nuovaPratica } from '../../../scripts/lib/orchestratore.mjs';

test('il verificatore non riceve come cartella sua quella delle note del lavoratore, né il file delle sue note', () => {
  const p = nuovaPratica({ num: 7, richiesta: 'x' });
  const lav = promptLavoratore({ p, regole: '', wtApp: '/wt', wtServer: '', cartellaNote: '/note' });
  const ver = promptVerificatore({ p, regole: '', wtApp: '/wt', wtServer: '', brief: 'COMPITO', cartellaNote: '/note' });
  const notaLavoratore = /`([^`]*note-7\.md)`/.exec(lav)[1];
  // O il file del lavoratore non sta dove scrive il verificatore, o il verificatore è avvisato di non leggerlo.
  const avvisato = /non leggere[^\n]*note/i.test(ver);
  expect(ver.includes(notaLavoratore) || (ver.includes('/note') && !avvisato)).toBe(false);
});

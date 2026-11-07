// #1680.1 giro 2, porta ri-provata al giro 3: il processo lasciato in vita dall'agente di #12 non si può più lanciare,
// perché l'agente vero ha solo strumenti di lettura chiusi nelle sue cartelle, e la chiave dei timbri sta fuori da tutte.
import { test, expect } from '@playwright/test';
import { resolve, relative, isAbsolute } from 'node:path';
import * as S from '../../../scripts/schede.mjs';
import { argomentiClaude } from '../../../scripts/orchestratore-locale.mjs';

const fuoriDa = (dir, f) => { const r = relative(resolve(dir), resolve(f)); return r.startsWith('..') || isAbsolute(r); };

test('l\'agente di una scheda non lancia processi né scrive, e non arriva alla chiave che firma le schede degli altri', () => {
  const radice = resolve('.');
  const radiceServer = resolve(radice, '..', 'filo-security');
  const a = S.argomentiScheda(argomentiClaude, { modello: 'haiku', num: '12', radiceServer });
  const dopo = (f) => a[a.indexOf(f) + 1];
  expect(a).toContain('--restricted');
  expect(dopo('--permission-mode')).toBe('dontAsk');
  expect(dopo('--tools').split(',').sort()).toEqual(['Glob', 'Grep', 'Read']);
  const chiave = S.fileChiave(S.CARTELLA_PREDEFINITA);
  const leggibili = [radice, ...a.filter((x, i) => a[i - 1] === '--add-dir')];
  for (const d of leggibili) expect(fuoriDa(d, chiave), `la chiave ${chiave} sta dentro ${d}, che l'agente legge`).toBe(true);
});

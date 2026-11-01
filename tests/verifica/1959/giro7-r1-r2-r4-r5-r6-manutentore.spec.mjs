// Verifica #1959 giro 7: righe dei worker che spariscono dalle novità, riga d'errore di uno strumento fallito,
// indicazione dell'owner che perde parole, promessa dentro una riga con fonte, nomi lunghi coperti nel rapporto.
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const carica = (p) => import(pathToFileURL(resolve(REPO, p)).href);
const schede = [{ num: '#812', numero: 812, priorita: 2, titolo: 'PDF in chat' }, { num: '#900', numero: 900, priorita: 1, titolo: 'Altro' }];

test('r1 una riscrittura letta su un blocco vuoto non cancella le righe dei worker fuse dopo', async () => {
  const M = await carica('scripts/manutentore.mjs');
  const N = await carica('scripts/release-novita.mjs');
  const c = M.controllaNovita({ versione: '9.9.10', features: ['Presto potrai allegare i PDF.'], promesse: [{ numero: '812', riga: 'Presto potrai allegare i PDF.' }] },
    { blocco: { version: '9.9.10', features: [], fixes: [] }, schede: schede.map((s) => ({ ...s, num: String(s.numero) })) });
  expect(c.ok, JSON.stringify(c.errori)).toBe(true);
  const dopo = N.righeDopo({ version: '9.9.10', features: [], fixes: ['Il menu non si chiude più da solo.', { testo: 'Le schede si trascinano.', segnalazione: 1956 }] },
    { features: c.novita.features, fixes: c.novita.fixes, originali: c.novita.originali });
  expect(dopo.fixes).toEqual(['Il menu non si chiude più da solo.', { testo: 'Le schede si trascinano.', segnalazione: 1956 }]);
});

test('r1 una riscrittura che non copre la riga con la segnalazione si rifiuta', async () => {
  const M = await carica('scripts/manutentore.mjs');
  const blocco = { version: '9.9.10', features: ['Allegare documenti Word in chat.', { testo: 'Le schede si spostano col trascinamento.', segnalazione: 1956 }], fixes: [] };
  const c = M.controllaNovita({ versione: '9.9.10', features: [{ testo: 'Word in chat.', da: [1] }] }, { blocco, schede: [] });
  expect(c.ok).toBe(false);
});

test('r2 la riga d’errore di prove di logica fallite è quella della prova fallita, non il log di una passata', async () => {
  const R = await carica('scripts/session-report.mjs');
  const uscita = ['Exit code 1', '# Subtest: l’aggiornamento senza rete', '# [updater] errore Error: rete caduta',
    'ok 3 - l’aggiornamento senza rete', '# Subtest: il taccuino si salva', 'not ok 4 - il taccuino si salva'].join('\n');
  expect(R.rigaErrore(uscita)).toContain('il taccuino si salva');
});

test('r4 un’indicazione dell’owner con una parola che comincia con due trattini resta intera', async () => {
  const M = await carica('scripts/manutentore.mjs');
  expect(M.senzaOpzioni(['non', 'usare', '--force', 'su', 'main']).join(' ')).toBe('non usare --force su main');
});

test('r5 una promessa dentro una riga che ha la sua fonte va dichiarata', async () => {
  const M = await carica('scripts/manutentore.mjs');
  const blocco = { version: '9.9.10', features: ['Allegare documenti Word in chat.'], fixes: [] };
  const c = M.controllaNovita({ versione: '9.9.10', features: [{ testo: 'Word in chat. E il supporto per i PDF arriva con la versione dopo.', da: [1] }] }, { blocco, schede: [] });
  expect(c.ok).toBe(false);
});

test('r6 nel rapporto il nome di un ramo o di una prova resta leggibile', async () => {
  const R = await carica('scripts/session-report.mjs');
  expect(R.rigaPulita('! [rejected] worker/Dff9ZSEFsHXwIZMJ8OfeGQAM-20261101T091523Z (fetch first)', 200)).toContain('Dff9ZSEFsHXwIZMJ8OfeGQAM');
});

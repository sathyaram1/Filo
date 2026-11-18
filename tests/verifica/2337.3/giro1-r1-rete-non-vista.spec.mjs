// Verifica #2337.3, giro 1, rilievo 1: il rapporto del manutentore non vede la rete chiamata dalla shell in forme
// comuni oltre a quelle del feedback, né la lettura di un ramo di un worker per sha o FETCH_HEAD dopo averlo scaricato.
import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { chiamaLaRete, leggeIRamiDeiWorker } from '../../../scripts/session-report.mjs';

const RETE = [
  '/usr/bin/env curl https://example.com',
  'sudo -u bob curl https://example.com',
  'watch -n 5 curl https://example.com',
  'find . -name x -exec curl https://example.com {} \\;',
  'FOO="a b" curl https://example.com',
  'time -p curl https://example.com',
  'busybox wget https://example.com',
  'exec 3<>/dev/tcp/example.com/80',
];

test('r1 la shell che scarica con un prefisso o un lanciatore comune conta come rete', () => {
  const visti = RETE.filter((c) => !chiamaLaRete(c));
  expect(visti, 'comandi che scaricano e restano puliti').toEqual([]);
});

test('r1 leggere un ramo di un worker appena scaricato, per FETCH_HEAD o per sha, conta come lettura dei rami', () => {
  const comandi = ['git show FETCH_HEAD:src/main/index.js', 'git log -p FETCH_HEAD', 'git diff main FETCH_HEAD'];
  expect(comandi.filter((c) => !leggeIRamiDeiWorker(c))).toEqual([]);
});

// Verifica #2337.3, giro 1, rilievo 1: il rapporto del manutentore non vede la rete chiamata dalla shell in forme
// comuni oltre a quelle del feedback (un lanciatore, un percorso intero, una variabile fra virgolette).
import '../../helpers/senzaSessione.mjs';
import { test, expect } from '@playwright/test';
import { chiamaLaRete } from '../../../scripts/session-report.mjs';

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

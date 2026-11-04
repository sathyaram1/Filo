// #2057 giro 1: un ramo che corregge una riga di novità già scritta e ne aggiunge un'altra nello stesso blocco.
// Uscita la versione, il riporto in cima non deve togliere dal registro la versione uscita né ripresentare come
// nuova la riga che chi aggiorna ha già letto.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spostaInCima, registroDa } from '../../../scripts/lib/novita-in-cima.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERO = readFileSync(join(ROOT, 'src', 'shared', 'patchNotes.js'), 'utf8');
const APRE = VERO.indexOf('const NOTES = [') + 'const NOTES = ['.length;
const CHIUDE = VERO.indexOf('\n  ];', APRE);

const registro = (riga257) => `${VERO.slice(0, APRE)}
    {
      version: '0.2.257', date: '2026-11-01',
      features: [
${riga257.map((t) => `        { testo: '${t}' },\n`).join('')}      ],
    },
    {
      version: '0.2.256', date: '2026-10-31',
      fixes: [
        { testo: 'Riga vecchia' },
      ],
    },${VERO.slice(CHIUDE)}`;

test('r1 la versione uscita resta nel registro e solo la riga aggiunta va in cima', () => {
  // Alla base del ramo la 0.2.257 non era uscita e aveva una riga; il ramo la corregge e ne aggiunge una.
  const prima = registroDa(registro(['La barra si apre col tasto destro']));
  const delRamo = registro(['La barra si apre col tasto destro o con Ctrl+B', 'Riga nuova del ramo']);
  // Riallineato, l'app è alla 0.2.257: quella versione è uscita.
  const r = spostaInCima(delRamo, { prima, manifesto: { version: '0.2.257' }, oggi: '2026-11-04' });
  // Rifiutare, e lasciare la scelta a chi riallinea, è un esito accettabile; spostare la riga già letta no.
  if (!r.ok) return;
  const dopo = registroDa(r.src);
  const versioni = dopo.map((n) => n.version);
  expect(versioni, 'la versione 0.2.257, uscita, sparisce dalla pagina Novità').toContain('0.2.257');
  expect(dopo[0].version).toBe('0.2.258');
  expect((dopo[0].features || []).map((x) => x.testo), 'chi è già alla 0.2.257 rilegge come nuova una riga già vista')
    .toEqual(['Riga nuova del ramo']);
});

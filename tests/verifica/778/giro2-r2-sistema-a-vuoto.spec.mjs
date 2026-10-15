// #778 giro 2, rilievo 2: su Linux il sistema a volte risponde a vuoto (nessuna finestra e nemmeno uno schermo, che
// esiste sempre). Un vuoto così non è «non c'è»: la finestra aperta si deve trovare e catturare lo stesso.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const Schermo = require(join(ROOT, 'src', 'main', 'services', 'schermo.js'));
const ACCESA = { schermo: { guarda: true } };

const immagine = () => ({
  isEmpty: () => false,
  getSize: () => ({ width: 800, height: 600 }),
  toBitmap: () => Buffer.alloc(800 * 600 * 4, 200),
  resize() { return this; },
  toJPEG: () => Buffer.from('jpeg'),
});

// Risponde a vuoto alle chiamate segnate in `vuote` (contate da 1), come il sistema visto nel contenitore.
function sistemaCheSalta(vuote) {
  let n = 0;
  return {
    piattaforma: () => 'linux',
    wayland: () => false,
    permessoMac: () => 'granted',
    fonti: async ({ lato = 0 } = {}) => {
      n += 1;
      if (vuote.includes(n)) return [];
      return [
        { id: 'window:101:0', nome: 'Errore - Programma di prova', tipo: 'finestra', displayId: '', immagine: lato > 0 ? immagine() : null },
        { id: 'screen:1:0', nome: 'Entire screen', tipo: 'schermo', displayId: '1', immagine: lato > 0 ? immagine() : null },
      ];
    },
    finestreFilo: () => [],
    maniglieFilo: () => [],
    schermi: () => ({ primario: '1', conFilo: '1', lato: 1920 }),
    delicata: async () => '',
  };
}

test('r2 l\'elenco arrivato a vuoto non fa dire che la finestra non c\'è', async () => {
  const S = Schermo.crea({ sistema: sistemaCheSalta([1]) });
  const a = { type: 'VEDI_SCHERMO', finestra: 'Errore - Programma di prova' };
  const r = await S.prepara(a, { settings: ACCESA, chiave: 't' });
  expect(r.esito && r.esito.output).toBeUndefined();
  expect(a._finestra && a._finestra.id).toBe('window:101:0');
});

test('r2 la cattura arrivata a vuoto non fa dire che la finestra non è più aperta', async () => {
  const S = Schermo.crea({ sistema: sistemaCheSalta([2]) });
  const a = { type: 'VEDI_SCHERMO', finestra: 'Errore - Programma di prova' };
  await S.prepara(a, { settings: ACCESA, chiave: 't' });
  const g = await S.guarda(a, { chiave: 't', leggi: async () => 'Il dialogo chiede di salvare.' });
  expect(g.output.errore).toBeUndefined();
  expect(g.output.testo).toBe('Il dialogo chiede di salvare.');
});

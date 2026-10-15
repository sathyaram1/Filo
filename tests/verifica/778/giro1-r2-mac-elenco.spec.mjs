// #778 giro 1 — su un Mac senza «Registrazione schermo» il primo passo normale del modello (VEDI_SCHERMO senza nome,
// per avere l'elenco) deve portare al permesso: la domanda di macOS la prima volta, il tasto del pannello dopo un no.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Schermo = require('../../../src/main/services/schermo.js');
const ACCESA = { schermo: { guarda: true } };

function macFinto(permesso) {
  const conti = { domanda: 0, pannello: 0 };
  return {
    conti,
    piattaforma: () => 'darwin',
    wayland: () => false,
    permessoMac: () => permesso,
    chiediPermessoMac: async () => { conti.domanda += 1; },
    apriPannello: async () => { conti.pannello += 1; },
    fonti: async () => [],
    finestreFilo: () => [{ id: 'filo:1', tipo: 'finestra', filo: true, nome: 'Filo: Home', url: 'filo://newtab/', wc: null }],
    maniglieFilo: () => [],
    schermi: () => ({ primario: '1', conFilo: '1', lato: 1920 }),
    delicata: async () => '',
  };
}

test('r2 permesso mai chiesto: chiedere l\'elenco fa comparire la domanda di macOS o il tasto del pannello', async () => {
  const sis = macFinto('not-determined');
  const r = await Schermo.crea({ sistema: sis }).prepara({ type: 'VEDI_SCHERMO' }, { settings: ACCESA, chiave: 't' });
  const out = r.esito.output;
  expect(sis.conti.domanda > 0 || !!out.apri, 'né la domanda di macOS né «Apri le impostazioni»').toBe(true);
});

test('r2 permesso negato: con l\'elenco arriva anche il tasto «Apri le impostazioni»', async () => {
  const sis = macFinto('denied');
  const r = await Schermo.crea({ sistema: sis }).prepara({ type: 'VEDI_SCHERMO' }, { settings: ACCESA, chiave: 't' });
  expect(r.esito.output.apri).toBe(Schermo.PANNELLO_MAC);
});

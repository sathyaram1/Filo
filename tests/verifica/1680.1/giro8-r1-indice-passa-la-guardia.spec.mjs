// #1680.1 giro 8 (dopo il riallineamento): l'indice si riscrive mentre gli agenti lavorano, leggendolo dal disco; quello
// che un agente ci ha scritto nel frattempo passa per buono alla guardia, e il suo esito vale.
import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from '../../../scripts/schede.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const buona = (num) => ({
  numero: String(num), stato: 'todo', mittente: 'utente', titolo_breve: 'Menu che non si apre',
  riassunto: 'Il menu del tasto destro non si apre sulle immagini.', tipo: 'bug', area: 'browser-schede',
  file_probabili: ['src/content/menu.js'], urgente: false, valido: 'si', prova: 'Letto il gestore: il caso manca.',
  risolto_su_main: null, doppione_di: [], parole_chiave: ['menu'], note: '',
});

test('r1 un agente che riscrive l\'indice mentre un altro salva: la guardia lo rimette e il suo esito non vale', async () => {
  const dir = cartellaTemporanea('verifica-1680-indice');
  try {
    mkdirSync(dir, { recursive: true });
    const voci = [{ id: 'a', num: '12', stato: 'todo', aggiornato: 't1' }, { id: 'b', num: '13', stato: 'todo', aggiornato: 't1' }];
    writeFileSync(join(dir, S.INDICE), JSON.stringify(S.conTimbro({ creato: '2026-11-07T08:00:00.000Z', aperti: voci }, S.chiaveTimbri(dir, { crea: true }))));
    let partito; const salvaPartita = new Promise((r) => { partito = r; });
    let fatto; const manomesso = new Promise((r) => { fatto = r; });
    // #12 legge un testo ostile e, mentre #13 sta salvando (una chiamata di rete), toglie #12 dall'indice; poi lavora ancora.
    const agente = async ({ num }) => {
      if (num === '12') {
        await salvaPartita;
        writeFileSync(join(dir, S.INDICE), JSON.stringify({ creato: '2026-11-07T08:00:00.000Z', aperti: [voci[1]] }));
        fatto();
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: true, costo: 0, testo: JSON.stringify(buona(num)) };
    };
    const salva = async (d) => {
      if (d.numero === '13') { partito(); await manomesso; }
      const v = voci.find((x) => x.num === d.numero);
      return { ok: true, aggiornato: 't2', scheda: { ...d.scheda, _fonte: { id: v.id, stato: v.stato, aggiornato: 't2', at: '2026-11-07T09:00:00.000Z', modello: d.modello } } };
    };
    const err = [];
    await S.lanciaAgenti(voci, { cartella: dir, modello: 'haiku', paralleli: 2, rilettura: false, dryRun: false, agente, salva, log() {}, err: (m) => err.push(m) });
    const letto = S.leggiIndice(dir);
    expect(err.join('\n'), 'la guardia dice che la cartella è stata toccata').toMatch(/CARTELLA DELLE SCHEDE TOCCATA/);
    expect((letto.aperti || []).map((f) => f.num), 'l\'indice ha ancora #12').toEqual(['12', '13']);
    expect(letto.fidato, 'l\'indice resta firmato dallo script').toBe(true);
  } finally {
    togliCartella(dir);
    rmSync(S.fileChiave(dir), { force: true });
  }
});

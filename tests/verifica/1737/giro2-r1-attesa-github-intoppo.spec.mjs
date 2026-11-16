// Verifica #1737 giro 2, rilievo 1: un intoppo passeggero di GitHub durante l'attesa dell'esito (una lettura che
// fallisce una volta) non deve far fermare il finish dell'owner dopo mezz'ora di attesa.

import { test, expect } from '@playwright/test';
import { attendiProvaRemota } from '../../../scripts/lib/prova-remota.mjs';
import { MARCA } from '../../../scripts/unit-fusione-azione.mjs';

const RAMO = 'a'.repeat(40);
const MAIN = 'b'.repeat(40);

function avvioCon(intoppo) {
  const fatti = new Set();
  const api = async (percorso) => {
    const dove = percorso.includes('/logs') ? 'registro' : percorso.includes('/jobs') ? 'lavori' : 'corse';
    if (dove === intoppo && !fatti.has(dove)) {
      fatti.add(dove);
      throw new Error(`GitHub risponde ${dove === 'registro' ? 404 : 502} a GET ${percorso.split('?')[0]}`);
    }
    if (dove === 'corse') return { workflow_runs: [{ id: 11, display_title: 'unit-fusione pc-x', status: 'completed', conclusion: 'success', html_url: 'https://github.com/x' }] };
    if (dove === 'lavori') return { jobs: [{ id: 22, name: 'unit' }] };
    return `${MARCA} ${JSON.stringify({ ramo: RAMO, main: MAIN, esito: 'verde', mainSha: MAIN })}\n`;
  };
  return { repo: 'proprietario/filo', ramo: RAMO, main: MAIN, corsa: 'pc-x', api, spec: [] };
}

for (const intoppo of ['corse', 'lavori', 'registro']) {
  test(`r1 una lettura di GitHub che fallisce una volta (${intoppo}) non butta l'attesa: l'esito arriva`, async () => {
    const prova = await attendiProvaRemota(avvioCon(intoppo), { scrivi: () => {}, aspetta: async () => {} });
    expect(prova.errore, 'un intoppo solo ha fermato il finish').toBeUndefined();
    expect(prova.esito).toBe('verde');
  });
}

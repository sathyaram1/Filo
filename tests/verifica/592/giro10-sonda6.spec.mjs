// Sonda 6 del giro 10 — leggere un segreto col terminale, e il livello 3.
import { test } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DA_WEB = { url: 'https://sito-ostile.example/pagina.html', tab: { id: 77, url: 'https://sito-ostile.example/pagina.html' } };

const msg = (app, m) => app.evaluate(
  async (_e, { m: mm, s }) => globalThis.SN_HANDLE_MESSAGE(mm, s), { m, s: DA_WEB },
);
const run = (app, action) => msg(app, { type: 'filo_run_action', action });
const conferma = (app, action) => msg(app, { type: 'filo_confirm_action', action });

test('sonda: cat di un segreto e livello 3 auto-confermato', async ({ app }) => {
  const dir = cartellaTemporanea('filo-seg-');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'chiave.txt');
  writeFileSync(file, 'SEGRETO-DELL-UTENTE-42\n', 'utf8');

  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }); });

  const livelli = await app.evaluate(async (_e, f) => {
    const L = globalThis.SN_ACTION_LEVELS;
    return {
      cat: L.levelFor({ type: 'ESEGUI_COMANDO', comando: `cat "${f}"` }),
      ls: L.levelFor({ type: 'ESEGUI_COMANDO', comando: 'ls' }),
    };
  }, file);
  console.log('LIVELLI COMANDI:', JSON.stringify(livelli));

  const r = await run(app, { type: 'ESEGUI_COMANDO', comando: `cat "${file}"` });
  console.log('CAT DA WEB:', JSON.stringify(r).slice(0, 400));

  // Livello 3: RUN (registra il pending) poi CONFIRM (lo consuma).
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta\nVive a Lisbona' });
  });
  const a3 = { type: 'CANCELLA_MEMORIA' };
  const r1 = await run(app, a3);
  console.log('RUN CANCELLA_MEMORIA:', JSON.stringify(r1).slice(0, 200));
  const r2 = await conferma(app, a3);
  console.log('CONFIRM CANCELLA_MEMORIA:', JSON.stringify(r2).slice(0, 200));
  const mem = await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getMemory()));
  console.log('MEMORIA DOPO:', mem);
});

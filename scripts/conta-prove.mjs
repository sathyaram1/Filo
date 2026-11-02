// conta-prove.mjs — le prove (test(), it()) che il lavoro aggiunge, tocca o toglie, e il codice che cambia: il numero
// lo dà lo script, se bastano lo giudica chi legge (#1363). Regole: tests/unit/contaProve.test.mjs.
// Uso: node scripts/conta-prove.mjs [--base <sha>] [--head <sha>] [--json] (base: dove il ramo si stacca da origin/main)

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedRepoRoot } from './lib/tools-pin.mjs';
import { testoDelConto } from './lib/conta-prove.mjs';
import { contaDelLavoro, estremiDelLavoro } from './lib/lettura-diff.mjs';

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : (pinnedRepoRoot() || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const argv = process.argv.slice(2);
  const o = { json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') o.json = true;
    else if ((argv[i] === '--base' || argv[i] === '--head') && argv[i + 1]) o[argv[i].slice(2)] = argv[++i];
    else { console.error(`argomento non capito: ${argv[i]}. Uso: node scripts/conta-prove.mjs [--base <sha>] [--head <sha>] [--json]`); process.exit(1); }
  }
  const e = estremiDelLavoro(root, { base: o.base, head: o.head });
  const c = e.errore ? e : contaDelLavoro(root, e.base, e.head);
  if (c.errore) { console.error(`Non riesco a contare: ${c.errore}.`); process.exit(3); }
  if (e.avviso) console.error(`Attenzione: ${e.avviso}.`);
  console.log(o.json ? JSON.stringify({ base: e.base, head: e.head, ...c }, null, 2) : `Da ${e.base.slice(0, 12)} a ${e.head.slice(0, 12)}.\n${testoDelConto(c.conto, { codice: c.codice })}`);
}

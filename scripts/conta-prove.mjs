// conta-prove.mjs — le prove (test(), it()) che il lavoro aggiunge, tocca o toglie, e il codice che cambia: il numero
// lo dà lo script, se bastano lo giudica chi legge (#1363). Regole: tests/unit/contaProve.test.mjs.
// Uso: node scripts/conta-prove.mjs [--base <sha>] [--head <sha>] [--server <clone>] [--json] (base: dove il ramo si stacca da origin/main)

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolutizeOutput, pinnedRepoRoot } from './lib/tools-pin.mjs';
import { PROVE_SERVER, testoDelConto } from './lib/conta-prove.mjs';
import { contaDelLavoro, estremiDelLavoro, parteDelServer, ramoCorrente } from './lib/lettura-diff.mjs';

const USO = 'node scripts/conta-prove.mjs [--base <sha>] [--head <sha>] [--server <clone>] [--json]';

/** La parte del server di un lavoro server: lo stesso conto che vede il lettore del diff (#2093). PURA. */
export function testoDelServer({ ramo = '', base = '', head = '', conto, codice, vuoto = '', nonLetto = '' } = {}) {
  if (nonLetto) return `Server: le prove di filo-security non si sono potute contare: ${nonLetto}.`;
  if (vuoto) return `Server: ${vuoto}, nessuna prova da contare.`;
  return `Server, ramo ${ramo} di filo-security, da ${base.slice(0, 12)} a ${head.slice(0, 12)}.\n${testoDelConto(conto, { codice, prove: PROVE_SERVER })}`;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : (pinnedRepoRoot() || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  absolutizeOutput(root);
  const argv = process.argv.slice(2);
  const o = { json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') o.json = true;
    else if (['--base', '--head', '--server'].includes(argv[i]) && argv[i + 1]) o[argv[i].slice(2)] = argv[++i];
    else { console.error(`argomento non capito: ${argv[i]}. Uso: ${USO}`); process.exit(1); }
  }
  const e = estremiDelLavoro(root, { base: o.base, head: o.head });
  const c = e.errore ? e : contaDelLavoro(root, e.base, e.head);
  if (c.errore) { console.error(`Non riesco a contare: ${c.errore}.`); process.exit(3); }
  if (e.avviso) console.error(`Attenzione: ${e.avviso}.`);
  // Il ramo del server porta il nome di quello dell'app, come nella lettura del diff.
  const server = o.server ? parteDelServer(resolve(o.server), ramoCorrente(root)) : null;
  const { diff: _diff, ...serverSenzaDiff } = server || {};
  const app = `Da ${e.base.slice(0, 12)} a ${e.head.slice(0, 12)}.\n${testoDelConto(c.conto, { codice: c.codice })}`;
  console.log(o.json
    ? JSON.stringify({ base: e.base, head: e.head, ...c, ...(server ? { server: serverSenzaDiff } : {}) }, null, 2)
    : [app, ...(server ? ['', testoDelServer(server)] : [])].join('\n'));
  // Chi ha chiesto il server e non l'ha avuto non deve prendere il conto dell'app per quello intero.
  if (server && server.nonLetto) process.exitCode = 3;
}

// Da dove prende il Node ogni `actions/setup-node` dei workflow: un file `.node-version` o un numero scritto a mano.
// Segue le uscite di un passo (`steps.X.outputs`) e di un altro lavoro (`needs.J.outputs`) fino a chi legge il file.
// Chi lo usa: tests/unit/nodeDeiWorkflow.test.mjs (sentinella del #2207) e tests/unit/releaseSuite.test.mjs.

const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');

/** I lavori di un workflow, col loro testo. PURA. */
export function lavori(testo) {
  const righe = senzaCommenti(testo).split('\n');
  const da = righe.findIndex((r) => /^jobs:\s*$/.test(r));
  const out = [];
  if (da < 0) return out;
  for (let i = da + 1; i < righe.length; i++) {
    const m = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(righe[i]);
    if (m) out.push({ nome: m[1], righe: [] });
    else if (out.length) out[out.length - 1].righe.push(righe[i]);
  }
  return out.map((j) => ({ nome: j.nome, testo: j.righe.join('\n') }));
}

function passi(testoLavoro) {
  return testoLavoro.split(/\n(?= {6}- )/).filter((p) => /^ {6}- /.test(p)).map((corpo) => ({
    corpo,
    id: (corpo.match(/^ {6}(?:- | {2})id:\s*([\w-]+)\s*$/m) || [])[1] || '',
    nome: (corpo.match(/^ {6}(?:- | {2})name:\s*(.+)$/m) || [])[1] || '',
  }));
}

function uscita(testoLavoro, chiave) {
  const righe = testoLavoro.split('\n');
  const i = righe.findIndex((r) => /^ {4}outputs:\s*$/.test(r));
  if (i < 0) return '';
  for (let k = i + 1; k < righe.length && !/^ {0,4}\S/.test(righe[k]); k++) {
    const m = /^ {6}([\w-]+):\s*(.+)$/.exec(righe[k]);
    if (m && m[1] === chiave) return m[2].trim();
  }
  return '';
}

const eSetupNode = (p) => /^\s*(?:- )?uses:\s*actions\/setup-node@/m.test(p.corpo);

/** { file } se il valore viene da un `.node-version`, { letterale } se è scritto a mano, { errore } se non si segue. */
function daDoveViene(valore, lavoro, tutti, profondita = 0) {
  const v = String(valore || '').trim().replace(/^(['"])(.*)\1$/, '$2');
  if (profondita > 5) return { errore: `catena troppo lunga da ${v}` };
  let m = /^\$\{\{\s*steps\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}$/.exec(v);
  if (m) {
    const passo = passi(lavoro.testo).find((p) => p.id === m[1]);
    if (!passo) return { errore: `${lavoro.nome}: nessun passo con id ${m[1]}` };
    if (eSetupNode(passo)) return fonteDelSetup(passo, lavoro, tutti, profondita + 1);
    const letto = (passo.corpo.match(/<\s*"?([^\s"';)]*\.node-version)\b/) || [])[1];
    if (!letto || !new RegExp(`\\b${m[2]}=`).test(passo.corpo)) return { errore: `${lavoro.nome}: il passo ${m[1]} non scrive ${m[2]} da un .node-version` };
    return { file: letto };
  }
  m = /^\$\{\{\s*needs\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}$/.exec(v);
  if (m) {
    const altro = tutti.find((j) => j.nome === m[1]);
    if (!altro) return { errore: `${lavoro.nome}: nessun lavoro ${m[1]}` };
    const val = uscita(altro.testo, m[2]);
    if (!val) return { errore: `${m[1]}: nessuna uscita ${m[2]}` };
    return daDoveViene(val, altro, tutti, profondita + 1);
  }
  return { letterale: v };
}

function fonteDelSetup(passo, lavoro, tutti, profondita = 0) {
  const file = (passo.corpo.match(/^\s*node-version-file:\s*(\S+)\s*$/m) || [])[1];
  if (file) return { file: file.replace(/^(['"])(.*)\1$/, '$2') };
  const valore = (passo.corpo.match(/^\s*node-version:\s*(.+)$/m) || [])[1];
  if (!valore) return { errore: `${lavoro.nome}: setup-node senza versione` };
  return daDoveViene(valore, lavoro, tutti, profondita);
}

/** Ogni setup-node di un workflow: [{ lavoro, passo, fonte }]. PURA. */
export function nodeDeiWorkflow(testo) {
  const tutti = lavori(testo);
  const out = [];
  for (const lavoro of tutti) {
    for (const passo of passi(lavoro.testo).filter(eSetupNode)) {
      out.push({ lavoro: lavoro.nome, passo: passo.nome || passo.id, fonte: fonteDelSetup(passo, lavoro, tutti) });
    }
  }
  return out;
}

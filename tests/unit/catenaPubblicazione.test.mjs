// La catena di pubblicazione non si apre da un ramo (#1073): i segreti stanno nell'ambiente `rilascio`,
// aperto al solo main, e il tag v* lo crea l'app di pubblicazione. La difesa vera la fa GitHub (ambiente,
// regola sui tag): qui si tiene che i workflow onesti non la scavalchino e non si rompano quando si accende.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARTELLA = resolve(ROOT, '.github', 'workflows');
const WORKFLOW = readdirSync(CARTELLA)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ nome: f, testo: readFileSync(resolve(CARTELLA, f), 'utf8') }));
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

const AMBIENTE = 'rilascio';

const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');

/** I segreti che un testo nomina, GITHUB_TOKEN escluso; anche quelli passati in blocco (`toJSON(secrets)`, `secrets: inherit`). */
function segreti(testo) {
  const righe = senzaCommenti(testo);
  const nomi = [...righe.matchAll(/secrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]).filter((n) => n !== 'GITHUB_TOKEN');
  if (/secrets\s*\[|toJSON\(\s*secrets\s*\)|^\s*secrets:\s*inherit\b/m.test(righe)) nomi.push('(tutti)');
  return nomi;
}

function jobs(testo) {
  const righe = testo.split(/\r?\n/);
  const da = righe.findIndex((r) => /^jobs:\s*$/.test(r));
  assert.ok(da >= 0, 'workflow senza `jobs:`');
  const out = [];
  for (let i = da + 1; i < righe.length; i++) {
    const m = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(righe[i]);
    if (m) out.push({ nome: m[1], righe: [] });
    else if (out.length) out[out.length - 1].righe.push(righe[i]);
  }
  return out.map((j) => ({ nome: j.nome, testo: j.righe.join('\n') }));
}

function ambiente(testoJob) {
  const righe = testoJob.split('\n');
  const i = righe.findIndex((r) => /^ {4}environment:/.test(r));
  if (i < 0) return null;
  const valore = righe[i].replace(/^ {4}environment:\s*/, '').trim();
  const nome = valore || (righe.slice(i + 1).find((r) => /^ {6}name:/.test(r)) || '').replace(/^ {6}name:\s*/, '').trim();
  return nome.replace(/^(['"])(.*)\1$/, '$2');
}

function passi(testoJob) {
  return senzaCommenti(testoJob).split(/\n(?= {6}- )/).filter((p) => /^ {6}- /.test(p));
}

/**
 * I job che nominano un segreto fuori dall'ambiente fisso. Un ambiente condizionale non basta (#1504): dove vale
 * vuoto, cioè su un ramo, il segreto arriva lo stesso, col valore omonimo del repo, a un job che fa girare quel ramo.
 */
function jobSenzaAmbiente(testo) {
  return jobs(testo)
    .map((j) => ({ job: j.nome, segreti: [...new Set(segreti(j.testo))], ambiente: ambiente(j.testo) }))
    .filter((j) => j.segreti.length && j.ambiente !== AMBIENTE);
}

describe('i segreti si leggono solo dentro l\'ambiente rilascio', () => {
  for (const { nome, testo } of WORKFLOW) {
    test(`${nome}: nessun segreto fuori da un job`, () => {
      const prima = testo.split(/^jobs:\s*$/m)[0];
      assert.deepEqual(segreti(prima), [],
        `${nome} legge segreti a livello di workflow: li vedrebbe ogni job, anche quelli senza ambiente`);
    });

    test(`${nome}: ogni job che nomina un segreto dichiara \`environment: ${AMBIENTE}\`, fisso`, () => {
      const scoperti = jobSenzaAmbiente(testo)
        .map((j) => `${j.job} legge ${j.segreti.join(', ')} con l'ambiente ${j.ambiente === null ? 'assente' : `«${j.ambiente}»`}`);
      assert.deepEqual(scoperti, [],
        `in ${nome}, senza \`environment: ${AMBIENTE}\` il segreto arriva col valore omonimo del repo, se c'è, anche alla corsa di un ramo. ` +
        'Il lavoro che legge il segreto sta a parte, nell\'ambiente fisso, con un `if:` che lo salta fuori da main');
    });
  }

  test('la regola riconosce i job che la scavalcano', () => {
    const wf = (corpo) => `on: workflow_dispatch\njobs:\n  lavoro:\n    runs-on: ubuntu-latest\n${corpo}    steps:\n      - name: x\n        env:\n          P: \${{ secrets.FILO_BUILD_PASSPHRASE }}\n        run: true\n`;
    const scoperti = (corpo) => jobSenzaAmbiente(wf(corpo)).map((j) => j.job);
    assert.deepEqual(scoperti(''), ['lavoro'], 'senza ambiente');
    assert.deepEqual(scoperti("    environment: ${{ github.ref == 'refs/heads/main' && 'rilascio' || '' }}\n"), ['lavoro'],
      'l\'ambiente solo su main lascia il segreto del repo alla corsa di un ramo');
    assert.deepEqual(scoperti("    environment:\n      name: ${{ github.ref == 'refs/heads/main' && 'rilascio' || '' }}\n"), ['lavoro']);
    assert.deepEqual(scoperti('    environment: rilascio\n'), []);
    assert.deepEqual(scoperti("    environment: 'rilascio'\n"), []);
    assert.deepEqual(scoperti('    environment:\n      name: rilascio\n'), []);
    const inBlocco = 'on: push\njobs:\n  chiama:\n    uses: ./.github/workflows/altro.yml\n    secrets: inherit\n';
    assert.deepEqual(jobSenzaAmbiente(inBlocco).map((j) => j.job), ['chiama'], '`secrets: inherit` passa tutti i segreti');
  });

  test('le metà della pubblicazione dichiarano l\'ambiente per intero, non solo su main', () => {
    const rel = WORKFLOW.find((w) => w.nome === 'release.yml');
    assert.ok(rel, 'manca release.yml');
    const per = Object.fromEntries(jobs(rel.testo).map((j) => [j.nome, ambiente(j.testo)]));
    for (const n of ['scegli', 'release', 'release-mac', 'release-linux']) {
      assert.equal(per[n], AMBIENTE, `il job ${n} di release.yml deve stare nell'ambiente ${AMBIENTE}`);
    }
  });
});

test('ogni workflow dichiara i propri permessi: il predefinito del repo può stare su sola lettura', () => {
  for (const { nome, testo } of WORKFLOW) {
    assert.match(testo, /^permissions:/m,
      `${nome} non dichiara \`permissions:\`: con il predefinito del repo su sola lettura perderebbe quello che gli serve`);
  }
});

describe('il tag v* lo crea l\'app di pubblicazione, quando c\'è', () => {
  const rel = WORKFLOW.find((w) => w.nome === 'release.yml');
  const win = jobs(rel.testo).find((j) => j.nome === 'release');
  const ps = passi(win.testo);
  const iApp = ps.findIndex((p) => /uses:\s*actions\/create-github-app-token@/.test(p));
  const iPubblica = ps.findIndex((p) => /gh release edit[^\n]*--draft=false/.test(p));
  const iBuild = ps.findIndex((p) => /run:\s*npm run release\s*$/m.test(p));
  const iNumero = ps.findIndex((p) => /scripts\/release-bump\.mjs/.test(p));
  const COL_FALLBACK = /GH_TOKEN:\s*\$\{\{\s*steps\.app\.outputs\.token\s*\|\|\s*secrets\.GITHUB_TOKEN\s*\}\}/;
  // I nomi che la guida fa creare all'owner nell'ambiente: con un altro nome il passo si salta muto e il tag
  // lo crea il GITHUB_TOKEN (#1406). Si cambia il codice, non la sua configurazione.
  const APP_ID = 'FILO_PUBLISH_APP_ID';
  const APP_KEY = 'FILO_PUBLISH_APP_KEY';
  const NOMI_GUIDA = `l'app si legge da vars.${APP_ID} e secrets.${APP_KEY}, i nomi configurati nell'ambiente`;

  test('il token dell\'app si conia solo se la variabile c\'è, prima del numero di versione', () => {
    assert.ok(iApp >= 0, 'manca il passo che conia il token dell\'app: con la regola sui tag accesa la versione non uscirebbe');
    assert.match(ps[iApp], /^\s*id:\s*app\s*$/m);
    assert.match(ps[iApp], new RegExp(`if:[^\\n]*vars\\.${APP_ID} != ''`),
      'senza la condizione sulla variabile il passo fallisce finché l\'app non esiste, e non esce più niente');
    assert.match(ps[iApp], new RegExp(`app-id:\\s*\\$\\{\\{\\s*vars\\.${APP_ID}\\s*\\}\\}`), NOMI_GUIDA);
    assert.match(ps[iApp], new RegExp(`private-key:\\s*\\$\\{\\{\\s*secrets\\.${APP_KEY}\\s*\\}\\}`), NOMI_GUIDA);
    assert.ok(iNumero > iApp && iBuild > iNumero,
      'il token va coniato prima del numero di versione: un\'app configurata male non deve consumarne uno');
  });

  test('build, controllo e pubblicazione usano il token dell\'app, e senza app il GITHUB_TOKEN', () => {
    assert.ok(iPubblica > iApp, 'il passo che rende pubblica la bozza (e crea il tag) deve venire dopo il token');
    for (const i of [iBuild, iPubblica]) assert.match(ps[i], COL_FALLBACK, `passo senza il token dell'app:\n${ps[i].split('\n')[0]}`);
    const controllo = ps.find((p) => /I file per Windows sono davvero nella bozza/.test(p));
    assert.match(controllo, COL_FALLBACK, 'una bozza si legge con lo stesso token che l\'ha creata');
  });

  test('nessun altro passo crea tag v* fuori dall\'app', () => {
    for (const { nome, testo } of WORKFLOW) {
      const righe = senzaCommenti(testo);
      assert.doesNotMatch(righe, /git tag\s+v|git push[^\n]*--tags|git push[^\n]*refs\/tags|gh release create/,
        `${nome} crea un tag a mano: la regola sui tag lo respingerebbe, e il tag v* deve nascere dall'app`);
    }
  });
});

// Senza firma electron-updater controlla solo lo sha512 del latest.yml, che sta nella release stessa: il nome
// dell'editore, quando la firma arriva (#887), è ciò che gli fa verificare anche chi ha firmato l'installer.
const CHIAVI_FIRMA = ['certificateFile', 'certificateSubjectName', 'certificateSha1', 'azureSignOptions', 'sign'];

function firmaAccesa(win, testoJobWindows) {
  if (CHIAVI_FIRMA.some((k) => win?.[k])) return true;
  if (win?.signtoolOptions && Object.keys(win.signtoolOptions).some((k) => k !== 'publisherName')) return true;
  const righe = senzaCommenti(testoJobWindows);
  if (/\b(WIN_)?CSC_LINK\b|\bAZURE_(TENANT|CLIENT)_ID\b/.test(righe)) return true;
  return !/CSC_IDENTITY_AUTO_DISCOVERY:\s*["']?false/.test(righe);
}

function editoreDichiarato(win) {
  const pieno = (v) => (Array.isArray(v) ? v.some((x) => String(x).trim()) : !!String(v ?? '').trim());
  return pieno(win?.signtoolOptions?.publisherName) || pieno(win?.publisherName) || pieno(win?.azureSignOptions?.publisherName);
}

describe('quando l\'installer per Windows si firma, l\'editore è dichiarato', () => {
  const NON_FIRMA = '        env:\n          CSC_IDENTITY_AUTO_DISCOVERY: "false"\n';

  test('il riconoscimento della firma regge i casi tipici', () => {
    assert.equal(firmaAccesa({ target: 'nsis' }, NON_FIRMA), false);
    assert.equal(firmaAccesa({ signtoolOptions: { publisherName: 'X' } }, NON_FIRMA), false);
    assert.equal(firmaAccesa({ certificateSubjectName: 'X' }, NON_FIRMA), true);
    assert.equal(firmaAccesa({ signtoolOptions: { certificateSha1: 'ab' } }, NON_FIRMA), true);
    assert.equal(firmaAccesa({ azureSignOptions: { endpoint: 'e' } }, NON_FIRMA), true);
    assert.equal(firmaAccesa({}, '          WIN_CSC_LINK: ${{ secrets.X }}\n' + NON_FIRMA), true);
    assert.equal(firmaAccesa({}, '        run: npm run release\n'), true, 'senza lo spegnimento della ricerca il certificato si cerca');
    assert.equal(editoreDichiarato({ signtoolOptions: { publisherName: ['Filo'] } }), true);
    assert.equal(editoreDichiarato({ signtoolOptions: { publisherName: '  ' } }), false);
    assert.equal(editoreDichiarato({ azureSignOptions: { publisherName: 'Filo' } }), true);
  });

  test('package.json e release.yml: firma accesa → publisherName presente', () => {
    const rel = WORKFLOW.find((w) => w.nome === 'release.yml');
    const win = jobs(rel.testo).find((j) => j.nome === 'release');
    if (!firmaAccesa(pkg.build?.win, win.testo)) return;
    assert.ok(editoreDichiarato(pkg.build.win),
      'la build per Windows si firma ma build.win.signtoolOptions.publisherName (o azureSignOptions.publisherName) è vuoto: ' +
      'l\'aggiornamento automatico non controllerebbe chi ha firmato il pacchetto scaricato');
  });
});

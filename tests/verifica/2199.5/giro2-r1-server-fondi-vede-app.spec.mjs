// Verifica #2199.5 giro 2, r1: con l'app in attesa del server, le prove del server che server:fondi lancia dal PC devono
// leggere le fonti del bake dell'app in attesa. Lette dal checkout di main accanto al server (senza l'app), i generati del
// ramo del server non tornano, le prove sono rosse e né l'app né il server arrivano mai su main.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { esegui } from '../../../scripts/server-fondi-pratica.mjs';
import { FIRESTORE_BASE } from '../../../scripts/lib/firestore-auth.mjs';
import { sessione } from '../../../scripts/owner-feedback.mjs';
import { PULITO } from '../../helpers/bigliettoFinto.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

sessione.biglietto = async () => PULITO;

const RAMO = 'claude/fonte-42';
const FONTE = join('src', 'shared', 'feedbackAttese.js');
const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=prova', '-c', 'user.email=prova@filo.invalid', ...args], { cwd, encoding: 'utf8' });

function pratica() {
  const fields = {
    seq: { integerValue: '42' }, clientId: { stringValue: 'local:claude' }, status: { stringValue: 'working' },
    statusPublic: { stringValue: 'open' }, notes: { stringValue: '' }, senderProof: { stringValue: 'admin' },
    fiducia: { stringValue: 'fidato' },
    localOnly: { mapValue: { fields: { by: { stringValue: 'local:claude' }, at: { integerValue: '1' } } } },
  };
  return { name: 'projects/x/databases/(default)/documents/feedback/p', fields };
}

test('r1 server:fondi di un lavoro locale con l’app in attesa: le prove del server vedono le fonti del bake dell’app', async () => {
  const casa = cartellaTemporanea('filo-2199-5-');
  const vero = globalThis.fetch;
  try {
    // Il checkout di Filo accanto al server, su main come quello dell'owner; il ramo dell'app cambia una fonte del bake.
    const filo = join(casa, 'Filo');
    mkdirSync(join(filo, 'src', 'shared'), { recursive: true });
    git(filo, ['init', '-q', '-b', 'main']);
    writeFileSync(join(filo, FONTE), 'const RILETTURE = 8;\n');
    git(filo, ['add', '-A']);
    git(filo, ['commit', '-q', '-m', 'main']);
    git(filo, ['checkout', '-q', '-b', RAMO]);
    writeFileSync(join(filo, FONTE), 'const RILETTURE = 9;\n');
    git(filo, ['commit', '-q', '-am', 'app: cambia una fonte del bake']);
    git(filo, ['checkout', '-q', 'main']);

    const doc = pratica();
    globalThis.fetch = async (url, init = {}) => {
      if (init.method && init.method !== 'GET') return new Response('{}', { status: 200 });
      return String(url).includes('/feedback/p') ? new Response(JSON.stringify(doc), { status: 200 }) : new Response('{}', { status: 404 });
    };
    const lette = [];
    const righe = [];
    await esegui([RAMO, '--feedback', 'p'], {
      env: {}, bearer: 'finto', base: FIRESTORE_BASE, radice: filo, funzioni: join(casa, 'filo-security', 'functions'),
      log: (s) => righe.push(String(s)), err: (s) => righe.push(String(s)),
      verdetto: () => ({ ok: true, reason: 'verificato', server: { sha: 'c'.repeat(40) } }),
      fissa: (_c, ramo, sha) => ({ ok: true, ramo: `${ramo}-verificato-${sha.slice(0, 12)}`, togli: () => ({ ok: true }) }),
      lavoroDelRamo: async () => ({ ok: true, registro: false, lavoroFidato: false, attesa: '', motivo: 'il ramo non ha un registro' }),
      puntaRamo: () => 'c'.repeat(40), ramiAperti: () => [RAMO], ora: () => Date.now(), punta: () => 'a'.repeat(40),
      // Lo strumento del server prova la punta leggendo le fonti da FILO_PUBLIC_REPO o, senza, dal checkout ../Filo.
      lancia: (_cartella, _args, env) => {
        const pub = env.FILO_PUBLIC_REPO || filo;
        lette.push(readFileSync(join(pub, FONTE), 'utf8').trim());
        return 1;
      },
      chiediAlCancello: async () => ({ outcome: 'fault', reason: 'nessun cancello nella prova' }),
      allinea: () => {}, deployDaGitHub: () => false, registraMain: async () => ({ outcome: 'registrato' }), mainPrima: () => 'b'.repeat(40),
    });
    expect(lette.length, `le prove del server non sono partite:\n${righe.join('\n')}`).toBeGreaterThan(0);
    expect(lette[0], 'le prove del server leggono main senza l’app in attesa: i generati del ramo del server non tornano e server:fondi si ferma sempre')
      .toBe('const RILETTURE = 9;');
  } finally {
    globalThis.fetch = vero;
    togliCartella(casa);
  }
});

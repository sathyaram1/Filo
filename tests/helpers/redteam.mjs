// Il Red Team è in pausa per chi non è owner (#896): le prove della pagina e dei punti d'accesso lo aprono
// a tutti nel main, come se l'owner avesse acceso l'interruttore. La pausa la prova tests/redteam-pausa.spec.mjs.

export async function apriRedteamATutti(app) {
  await app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./services/defaultsStore').getRedteamOpen = async () => ({ risposto: true, aperto: true });
    await req('./services/redteamGate').rileggiOra();
  });
}

// La voce «Invia attacco» del tasto destro c'è solo per chi ha riscattato un codice (#991): qui il main lo crede,
// senza account né server. Chi lo legge dal server vero lo prova tests/redteam-verificati.spec.mjs.
export async function fingiRedteamerVerificato(app) {
  await app.evaluate(() => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const V = req('./services/redteamVerificato');
    V.noto = () => true;
    V.assicura = async () => true;
  });
}

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

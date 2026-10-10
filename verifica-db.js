// Verifica la connessione al database e i permessi, con le impostazioni di config.json.
// Uso: node verifica-db.js     (codice di uscita 0 = tutto ok)
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8').replace(/^﻿/, ''));
const WIN = (cfg.db.auth || 'windows') === 'windows';
const sql = WIN ? require('mssql/msnodesqlv8') : require('mssql');
const server = cfg.db.server + (cfg.db.instanceName ? '\\' + cfg.db.instanceName : '');

async function connetti() {
  if (!WIN) {
    const c = {
      server: cfg.db.server, database: cfg.db.database, user: cfg.db.user, password: cfg.db.password,
      options: { encrypt: false, trustServerCertificate: true }, connectionTimeout: 15000
    };
    if (cfg.db.instanceName) c.options.instanceName = cfg.db.instanceName; else if (cfg.db.port) c.port = cfg.db.port;
    return new sql.ConnectionPool(c).connect();
  }
  const drivers = cfg.db.odbcDriver ? [cfg.db.odbcDriver]
    : ['ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server', 'SQL Server Native Client 11.0', 'SQL Server'];
  let ultimo;
  for (const d of drivers) {
    try {
      return await new sql.ConnectionPool({
        connectionString: `Driver={${d}};Server=${server};Database=${cfg.db.database};Trusted_Connection=yes;TrustServerCertificate=yes;Encrypt=no;`
      }).connect();
    } catch (e) { ultimo = e; }
  }
  throw ultimo;
}

(async () => {
  console.log(`Database ${cfg.db.database} su ${server} (autenticazione ${WIN ? 'Windows' : 'SQL, utente ' + cfg.db.user})`);
  let pool;
  try { pool = await connetti(); }
  catch (e) { console.error('ERRORE di connessione:', e.message); process.exit(1); }
  const r = (await pool.request().query(`
    SELECT @@SERVERNAME AS nome, CAST(SERVERPROPERTY('ProductVersion') AS varchar(20)) AS versione,
           CAST(SERVERPROPERTY('Edition') AS varchar(60)) AS edizione, DB_NAME() AS db, SUSER_SNAME() AS utente,
           (SELECT COUNT(*) FROM BIT_RichProfAnag) AS richieste,
           (SELECT COUNT(*) FROM BIT_PROFILI) AS profili,
           (SELECT COUNT(*) FROM MB_Anagr) AS anagrafiche,
           (SELECT MAX(BITPRT_DATA) FROM BIT_RichProfAnag) AS ultimaRichiesta,
           HAS_PERMS_BY_NAME('dbo.BIT_RichProfAnag', 'OBJECT', 'SELECT') AS puoLeggere,
           HAS_PERMS_BY_NAME('dbo.BIT_RichProfAnag', 'OBJECT', 'INSERT') AS puoScrivere`)).recordset[0];
  console.log(`  Server:      ${r.nome} - SQL Server ${r.versione} ${r.edizione}`);
  console.log(`  Collegato:   ${r.db} come ${r.utente}`);
  console.log(`  Dati:        ${r.richieste} richieste profili, ${r.profili} righe magazzino profili, ${r.anagrafiche} anagrafiche`);
  console.log(`  Ultima richiesta: ${r.ultimaRichiesta ? new Date(r.ultimaRichiesta).toLocaleDateString('it-IT') : '-'}`);
  console.log(`  Permessi:    lettura ${r.puoLeggere ? 'SI' : 'NO'}, scrittura ${r.puoScrivere ? 'SI' : 'NO'}`);
  if (cfg.allowWrite && !r.puoScrivere) console.warn('  ATTENZIONE: allowWrite e attivo ma l\'utente non ha il permesso di scrittura.');
  if (cfg.allowWrite && /LEGNOEURO$/i.test(r.db)) console.warn('  ATTENZIONE: scrittura attiva sul database di PRODUZIONE.');
  await pool.close();
  process.exit(r.puoLeggere ? 0 : 1);
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });

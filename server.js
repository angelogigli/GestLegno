// GestLegno Web - server locale per LEGNOEURO
// Avvio: node server.js  (oppure avvia.bat)
const express = require('express');
const fs = require('fs');
const path = require('path');

// config.json può avere il BOM se scritto da PowerShell: lo tolgo
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
const PORT = cfg.port || 3010;
const EXPORT_DIR = path.join(__dirname, 'export');
// "windows" = autenticazione integrata (come GestLegno.exe), "sql" = utente e password
const WINAUTH = (cfg.db.auth || 'windows') === 'windows';
const sql = WINAUTH ? require('mssql/msnodesqlv8') : require('mssql');

// Driver ODBC da provare in ordine con l'autenticazione Windows
const ODBC_DRIVERS = cfg.db.odbcDriver ? [cfg.db.odbcDriver]
  : ['ODBC Driver 18 for SQL Server', 'ODBC Driver 17 for SQL Server', 'SQL Server Native Client 11.0', 'SQL Server'];
const serverName = cfg.db.server + (cfg.db.instanceName ? '\\' + cfg.db.instanceName : '');
// Con server locale provo anche "." (memoria condivisa), utile se TCP/IP è disattivato
const SERVERS = [serverName];
if (/^(127\.0\.0\.1|localhost|\.|\(local\))$/i.test(cfg.db.server)) {
  const inst = cfg.db.instanceName ? '\\' + cfg.db.instanceName : '';
  for (const s of ['.' + inst, 'localhost' + inst]) if (!SERVERS.includes(s)) SERVERS.push(s);
}
let serverUsato = serverName;
const testoErrore = e => {
  if (!e) return '';
  const parti = [];
  const add = x => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(add);
    if (typeof x === 'string') return parti.push(x);
    if (x.message && x.message !== '[object Object]') parti.push((x.sqlstate ? `[${x.sqlstate}] ` : '') + x.message);
    if (x.originalError) add(x.originalError);
    if (x.errors) add(x.errors);
    if (!x.message && !x.originalError && !x.errors) parti.push(JSON.stringify(x));
  };
  add(e);
  return [...new Set(parti)].join(' | ') || String(e);
};
const winConfig = (driver, server) => ({
  connectionString: `Driver={${driver}};Server=${server};Database=${cfg.db.database};`
    + `Trusted_Connection=yes;TrustServerCertificate=yes;Encrypt=no;`,
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  requestTimeout: 120000,
  connectionTimeout: 15000
});

const dbConfig = {
  server: cfg.db.server,
  database: cfg.db.database,
  user: cfg.db.user,
  password: cfg.db.password,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    useUTC: false,
    enableArithAbort: true
  },
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
  requestTimeout: 120000,
  connectionTimeout: 15000
};
if (cfg.db.instanceName) dbConfig.options.instanceName = cfg.db.instanceName;
else if (cfg.db.port) dbConfig.port = cfg.db.port;

let poolPromise = null;
let driverUsato = null;
async function connetti() {
  if (!WINAUTH) return new sql.ConnectionPool(dbConfig).connect();
  const errori = [];
  for (const d of ODBC_DRIVERS) {
    for (const s of SERVERS) {
      try {
        const pool = await new sql.ConnectionPool(winConfig(d, s)).connect();
        driverUsato = d; serverUsato = s;
        return pool;
      } catch (e) {
        const t = testoErrore(e);
        errori.push(`${d} @ ${s}: ${t}`);
        // driver non installato: inutile provare gli altri server
        if (/IM002|Data source name not found|nome origine dati/i.test(t)) break;
      }
    }
  }
  throw new Error('Connessione con autenticazione Windows non riuscita.\n' + errori.join('\n'));
}
function getPool() {
  if (!poolPromise) {
    poolPromise = connetti().catch(err => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

// Esegue una query parametrizzata. params: { nome: [sql.Tipo, valore] }
async function q(text, params = {}) {
  const pool = await getPool();
  const req = pool.request();
  for (const [k, [type, val]] of Object.entries(params)) req.input(k, type, val);
  const r = await req.query(text);
  return r.recordset || [];
}
// Come q, ma restituisce [] e l'errore invece di fallire (per tabelle con struttura non verificata)
async function qSafe(text, params = {}) {
  try { return { rows: await q(text, params) }; }
  catch (e) { return { rows: [], error: e.message }; }
}
const ids = arr => arr.map(Number).filter(Number.isInteger);

const app = express();
app.disable('x-powered-by');

// Accesso con utente e password (HTTP Basic). Sul server l'app è raggiungibile dalla rete.
// config.json: "accesso": { "attivo": true, "utenti": { "nome": "password" } }
const crypto = require('crypto');
const ACCESSO = cfg.accesso || { attivo: false };
const ugualeSicuro = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
// Dietro IIS (reverse proxy) l'indirizzo vero del client arriva in X-Forwarded-For
app.set('trust proxy', 'loopback');
// Blocco dopo troppi tentativi sbagliati: 10 errori in 15 minuti dallo stesso indirizzo = 15 minuti di blocco
const tentativi = new Map();
const FINESTRA = 15 * 60 * 1000, MAX_ERRORI = 10;
setInterval(() => { const ora = Date.now(); for (const [k, v] of tentativi) if (ora - v.inizio > FINESTRA) tentativi.delete(k); }, 60000).unref();
app.use((req, res, next) => {
  if (!ACCESSO.attivo) return next();
  const ip = req.ip;
  const hasAuth = !!req.headers.authorization;
  // Log diagnostico per il problema del doppio popup
  if (!hasAuth || req.url === '/' || req.url.startsWith('/api/')) {
    console.log(`[AUTH] ${req.method} ${req.url} - IP: ${ip} - Auth header: ${hasAuth ? 'SI' : 'NO'}`);
  }
  const t = tentativi.get(ip);
  if (t && t.errori >= MAX_ERRORI && Date.now() - t.inizio < FINESTRA) {
    return res.status(429).send('Troppi tentativi di accesso non riusciti. Riprova tra 15 minuti.');
  }
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const dec = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const i = dec.indexOf(':');
    const u = dec.slice(0, i), p = dec.slice(i + 1);
    const atteso = (ACCESSO.utenti || {})[u];
    if (atteso != null && ugualeSicuro(p, atteso)) { req.utente = u; return next(); }
    // credenziali sbagliate: conto il tentativo
    const x = (t && Date.now() - t.inizio < FINESTRA) ? t : { errori: 0, inizio: Date.now() };
    x.errori++; tentativi.set(ip, x);
    if (x.errori === MAX_ERRORI) console.warn(`${new Date().toLocaleString('it-IT')} accesso bloccato per ${ip} (utente "${u}")`);
  }
  res.set('WWW-Authenticate', 'Basic realm="GestLegno Web", charset="UTF-8"');
  res.status(401).send('Accesso riservato');
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  const t = testoErrore(err);
  console.error(t);
  res.status(500).json({ error: t });
});

/* ---------- Info ---------- */
app.get('/api/info', wrap(async (req, res) => {
  const r = await q(`SELECT @@VERSION AS versione, DB_NAME() AS db, SUSER_SNAME() AS utente`);
  res.json({ ...r[0], server: serverUsato, auth: WINAUTH ? 'windows' : 'sql', driver: driverUsato, allowWrite: !!cfg.allowWrite, utenteApp: req.utente || null });
}));

/* ---------- Anagrafiche ---------- */
app.get('/api/clienti', wrap(async (req, res) => {
  const raw = String(req.query.q || '').trim();
  const digits = raw.replace(/\D/g, '');
  const rows = await q(`
    SELECT TOP 40 pc.MBPC_Id AS id, pc.MBPC_Conto AS conto, pc.MBPC_SottoConto AS sotto,
           an.MBAN_RagSoc AS rag, an.MBAN_Comune AS com, an.MBAN_Provincia AS prov
    FROM MB_PiaCon pc
    JOIN MB_TipoConto tc ON tc.MBTC_Id = pc.MBPC_MBTC_Id
    JOIN MB_Anagr an ON an.MBAN_ID = pc.MBPC_MBAN_Id
    WHERE tc.MBTC_FlagCliente = 1
      AND (pc.MBPC_DataFineVal IS NULL OR pc.MBPC_DataFineVal > GETDATE())
      AND (@q = '' OR an.MBAN_RagSoc LIKE @like
           OR (@d <> '' AND (pc.MBPC_SottoConto LIKE @dlike OR pc.MBPC_Conto + pc.MBPC_SottoConto LIKE @dlike)))
    ORDER BY an.MBAN_RagSoc`, {
    q: [sql.NVarChar, raw], like: [sql.NVarChar, `%${raw}%`],
    d: [sql.VarChar, digits], dlike: [sql.VarChar, `%${digits}%`]
  });
  res.json(rows);
}));

// Articoli che sono profili: quelli con varianti presenti in BIT_PROFILI o nelle richieste
app.get('/api/articoli', wrap(async (req, res) => {
  const rows = await q(`
    SELECT a.MGAA_Id AS id, a.MGAA_Descr AS descr, a.MGAA_Matricola AS matr,
           RTRIM(a.MGAA_MBDC_Classe) AS classe, COUNT(DISTINCT v.MGVR_Id) AS nvar
    FROM MG_AnaArt a
    JOIN MG_Varianti v ON v.MGVR_MGAA_Id = a.MGAA_Id
    WHERE a.MGAA_Stato <> 4
      AND (EXISTS (SELECT 1 FROM BIT_PROFILI p WHERE p.BITPR_MGVR_ID = v.MGVR_Id)
        OR EXISTS (SELECT 1 FROM BIT_RichProfDett d WHERE d.BITPR_MGVR_ID = v.MGVR_Id))
    GROUP BY a.MGAA_Id, a.MGAA_Descr, a.MGAA_Matricola, a.MGAA_MBDC_Classe
    ORDER BY a.MGAA_Descr`);
  res.json(rows);
}));

app.get('/api/varianti', wrap(async (req, res) => {
  const rows = await q(`
    SELECT v.MGVR_Id AS id, v.MGVR_Codice AS codice, v.MGVR_Descr AS descr,
           v.MGVR_Spes AS sp, v.MGVR_Larg AS la
    FROM MG_Varianti v WHERE v.MGVR_MGAA_Id = @art
    ORDER BY v.MGVR_Spes, v.MGVR_Larg, v.MGVR_Descr`, { art: [sql.Int, +req.query.art] });
  res.json(rows);
}));

// Disponibile per lunghezza: stessa formula del programma VB
app.get('/api/stock', wrap(async (req, res) => {
  const rows = await q(`
    SELECT BITPR_LUNG AS lung,
           SUM(BITPR_PZ) - SUM(BITPR_PZ_EVA + ISNULL(BITPR_PZIMPEGNATI, 0)) AS pz
    FROM BIT_PROFILI
    WHERE BITPR_MGVR_ID = @mgvr
    GROUP BY BITPR_LUNG
    HAVING SUM(BITPR_PZ) - SUM(BITPR_PZ_EVA + ISNULL(BITPR_PZIMPEGNATI, 0)) > 0
    ORDER BY BITPR_LUNG`, { mgvr: [sql.Int, +req.query.mgvr] });
  res.json(rows.map(r => ({ lung: Number(r.lung), pz: Number(r.pz) })));
}));

// Stessa sezione su altri articoli (il vecchio programma le usa come alternativa)
app.get('/api/equivalenti', wrap(async (req, res) => {
  const rows = await q(`
    SELECT v2.MGVR_Id AS id, v2.MGVR_Descr AS descr, a.MGAA_Id AS art, a.MGAA_Descr AS adescr
    FROM MG_Varianti v1
    JOIN MG_Varianti v2 ON UPPER(REPLACE(v2.MGVR_Descr, ' ', '')) = UPPER(REPLACE(v1.MGVR_Descr, ' ', ''))
                       AND v2.MGVR_Id <> v1.MGVR_Id
    JOIN MG_AnaArt a ON a.MGAA_Id = v2.MGVR_MGAA_Id
    WHERE v1.MGVR_Id = @mgvr AND a.MGAA_Stato <> 4
      AND EXISTS (SELECT 1 FROM BIT_PROFILI p WHERE p.BITPR_MGVR_ID = v2.MGVR_Id
                  GROUP BY p.BITPR_MGVR_ID
                  HAVING SUM(p.BITPR_PZ) - SUM(p.BITPR_PZ_EVA + ISNULL(p.BITPR_PZIMPEGNATI, 0)) > 0)
    ORDER BY a.MGAA_Descr`, { mgvr: [sql.Int, +req.query.mgvr] });
  res.json(rows);
}));

/* ---------- Archivio richieste ---------- */
app.get('/api/anni', wrap(async (req, res) => {
  res.json(await q(`SELECT BITPRT_Anno AS anno, COUNT(*) AS n FROM BIT_RichProfAnag
                    WHERE BITPRT_Anno IS NOT NULL GROUP BY BITPRT_Anno ORDER BY BITPRT_Anno DESC`));
}));

async function listaRichieste({ anno, testo, top, soloConProposta }) {
  const raw = String(testo || '').trim();
  const rows = await q(`
    SELECT TOP (@top) r.BITRPT_ID AS id, r.BITPRT_DATA AS data, r.BITPRT_Anno AS anno, r.BITPRT_NumOrd AS num,
           r.BITPRT_Fatt AS fatt, r.BITPRT_ORDINARIO AS ordinario, r.BITPRT_IMPEGNATO AS impegnato,
           r.BITPRT_Riferimento AS rif, r.BITPRT_Riferimento1 AS rif1, r.BITPRT_Riferimento2 AS rif2,
           r.BITPRT_MBPC_ID AS mbpc, pc.MBPC_Conto AS conto, pc.MBPC_SottoConto AS sotto, an.MBAN_RagSoc AS rag
    FROM BIT_RichProfAnag r
    LEFT JOIN MB_PiaCon pc ON pc.MBPC_Id = r.BITPRT_MBPC_ID
    LEFT JOIN MB_Anagr an ON an.MBAN_ID = pc.MBPC_MBAN_Id
    WHERE (@anno IS NULL OR r.BITPRT_Anno = @anno)
      AND (@raw = '' OR an.MBAN_RagSoc LIKE @like OR r.BITPRT_Riferimento LIKE @like
           OR CAST(r.BITPRT_NumOrd AS varchar(20)) = @raw)
      AND (@solo = 0 OR EXISTS (SELECT 1 FROM Bit_ProfiliProposte p WHERE p.BITPR_BITRPT_Id = r.BITRPT_ID))
    ORDER BY r.BITPRT_DATA DESC, r.BITRPT_ID DESC`, {
    top: [sql.Int, Math.min(+top || 200, 2000)],
    anno: [sql.Int, anno ? +anno : null],
    raw: [sql.NVarChar, raw], like: [sql.NVarChar, `%${raw}%`],
    solo: [sql.Bit, soloConProposta ? 1 : 0]
  });
  if (!rows.length) return rows;
  const list = ids(rows.map(r => r.id)).join(',');
  const [det, prop, imp] = await Promise.all([
    q(`SELECT BITPR_BITPR_ID AS id, COUNT(*) AS righe, SUM(BITPR_PzRich) AS pz,
              SUM(CAST(BITPR_LungRich AS float) * BITPR_PzRich) AS lungtot
       FROM BIT_RichProfDett WHERE BITPR_BITPR_ID IN (${list}) GROUP BY BITPR_BITPR_ID`),
    q(`SELECT BITPR_BITRPT_Id AS id, COUNT(*) AS n FROM Bit_ProfiliProposte
       WHERE BITPR_BITRPT_Id IN (${list}) GROUP BY BITPR_BITRPT_Id`),
    q(`SELECT BITPRIM_BITRPT_ID AS id, COUNT(*) AS n FROM BIT_PROFILI_impegni
       WHERE BITPRIM_BITRPT_ID IN (${list}) GROUP BY BITPRIM_BITRPT_ID`)
  ]);
  const by = (arr) => Object.fromEntries(arr.map(x => [x.id, x]));
  const D = by(det), P = by(prop), I = by(imp);
  return rows.map(r => ({
    ...r,
    righe: D[r.id]?.righe || 0, pz: D[r.id]?.pz || 0, lungtot: D[r.id]?.lungtot || 0,
    proposte: P[r.id]?.n || 0, impegni: I[r.id]?.n || 0
  }));
}

app.get('/api/richieste', wrap(async (req, res) => {
  res.json(await listaRichieste({
    anno: req.query.anno, testo: req.query.q, top: req.query.top, soloConProposta: req.query.prop === '1'
  }));
}));

// La vista BITPLA_V_Errori citata nel VB non esiste: uso la tabella BITPLA_Errori,
// cercando le colonne di collegamento (id richiesta oppure numero/anno ordine).
let colErrori = null;
async function erroriPreparazione(t) {
  if (colErrori === null) {
    colErrori = (await qSafe(`SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BITPLA_Errori')`)).rows.map(r => r.name);
  }
  const find = re => colErrori.find(c => re.test(c));
  const cRpt = find(/RPT_?ID$/i), cNum = find(/NUMORD/i), cAnno = find(/ANNO/i);
  if (cRpt) return qSafe(`SELECT * FROM BITPLA_Errori WHERE [${cRpt}] = @id`, { id: [sql.Int, t.BITRPT_ID] });
  if (cNum) return qSafe(`SELECT * FROM BITPLA_Errori WHERE [${cNum}] = @num${cAnno ? ` AND [${cAnno}] = @anno` : ''}`,
    { num: [sql.Int, t.BITPRT_NumOrd], anno: [sql.Int, t.BITPRT_Anno] });
  return { rows: [] };
}

async function dettaglioRichiesta(id) {
  const P = { id: [sql.Int, id] };
  const testata = (await q(`
    SELECT r.*, pc.MBPC_Conto AS conto, pc.MBPC_SottoConto AS sotto, an.MBAN_RagSoc AS rag
    FROM BIT_RichProfAnag r
    LEFT JOIN MB_PiaCon pc ON pc.MBPC_Id = r.BITPRT_MBPC_ID
    LEFT JOIN MB_Anagr an ON an.MBAN_ID = pc.MBPC_MBAN_Id
    WHERE r.BITRPT_ID = @id`, P))[0];
  if (!testata) return null;
  const righe = await q(`
    SELECT d.BITPR_ID AS id, d.BITPR_MGVR_ID AS mgvr, d.BITPR_LungRich AS lung, d.BITPR_PzRich AS pz,
           d.BITPR_DA AS da, d.BITPR_A AS a, d.BITPR_DataIns AS dataIns,
           v.MGVR_Codice AS vcod, v.MGVR_Descr AS vdescr, v.MGVR_Spes AS sp, v.MGVR_Larg AS la,
           a.MGAA_Id AS art, a.MGAA_Descr AS adescr
    FROM BIT_RichProfDett d
    LEFT JOIN MG_Varianti v ON v.MGVR_Id = d.BITPR_MGVR_ID
    LEFT JOIN MG_AnaArt a ON a.MGAA_Id = v.MGVR_MGAA_Id
    WHERE d.BITPR_BITPR_ID = @id ORDER BY d.BITPR_ID`, P);
  const [proposte, impegni, palmA, palmB, errori] = await Promise.all([
    qSafe(`SELECT p.*, v.MGVR_Descr AS vdescr FROM Bit_ProfiliProposte p
           LEFT JOIN MG_Varianti v ON v.MGVR_Id = p.BITPR_MGVR_ID
           WHERE p.BITPR_BITRPT_Id = @id ORDER BY p.BITPR_LETTERA, p.BITPR_ID`, P),
    qSafe(`SELECT i.*, v.MGVR_Descr AS vdescr FROM BIT_PROFILI_impegni i
           LEFT JOIN MG_Varianti v ON v.MGVR_Id = i.BITPRIM_BITPR_MGVR_ID
           WHERE i.BITPRIM_BITRPT_ID = @id ORDER BY i.BITPRIM_ID`, P),
    qSafe(`SELECT * FROM BITPLA_PalmA WHERE BTPLA_BITRPT_Id = @id`, P),
    qSafe(`SELECT * FROM BITPLA_PalmB WHERE BTPLB_BITRPT_Id = @id`, P),
    erroriPreparazione(testata)
  ]);
  // Profili di magazzino richiamati dalle proposte / dagli impegni
  const prIds = ids([
    ...proposte.rows.map(p => p.BITPR_BITPR_ID),
    ...impegni.rows.map(i => i.BITPRIM_BITPR_ID)
  ].filter(x => x != null));
  const profili = prIds.length
    ? await qSafe(`SELECT pr.*, v.MGVR_Descr AS vdescr FROM BIT_PROFILI pr
                   LEFT JOIN MG_Varianti v ON v.MGVR_Id = pr.BITPR_MGVR_ID
                   WHERE pr.BITPR_ID IN (${[...new Set(prIds)].join(',')})`)
    : { rows: [] };
  return { testata, righe, proposte, impegni, profili, palmA, palmB, errori };
}

app.get('/api/richieste/:id', wrap(async (req, res) => {
  const d = await dettaglioRichiesta(+req.params.id);
  if (!d) return res.status(404).json({ error: 'Richiesta non trovata' });
  res.json(d);
}));

/* ---------- Nuova richiesta ---------- */
app.get('/api/prossimo-numero', wrap(async (req, res) => {
  const anno = +req.query.anno || new Date().getFullYear();
  // considera anche i numeri riservati da GestLegno.exe durante l'inserimento (BIT_PrenotaNumOrd)
  const r = await q(`SELECT 1 + (SELECT MAX(n) FROM (VALUES
      ((SELECT ISNULL(MAX(BITPRT_NumOrd), 0) FROM BIT_RichProfAnag WHERE BITPRT_Anno = @anno)),
      ((SELECT ISNULL(MAX(NumOrd), 0) FROM BIT_PrenotaNumOrd WHERE Anno = @anno))) AS t(n)) AS num`,
    { anno: [sql.Int, anno] });
  res.json({ anno, num: r[0].num });
}));

function sqlAnteprima(b) {
  const s = v => v ? `N'${String(v).replace(/'/g, "''")}'` : 'NULL';
  const d = b.data.replace(/-/g, '');
  return [
    'BEGIN TRANSACTION;', 'DECLARE @id int;', '',
    'INSERT INTO BIT_RichProfAnag (BITPRT_DATA, BITPRT_MBPC_ID, BITPRT_NumOrd, BITPRT_Anno, BITPRT_Fatt,',
    '  BITPRT_ORDINARIO, BITPRT_IMPEGNATO, BITPRT_Riferimento, BITPRT_Riferimento1, BITPRT_Riferimento2)',
    `VALUES ('${d}', ${+b.mbpc}, ${+b.num}, ${+b.anno}, 0, ${b.ordinario ? 1 : 0}, 0, ${s(b.rif[0])}, ${s(b.rif[1])}, ${s(b.rif[2])});`,
    'SET @id = SCOPE_IDENTITY();', '',
    'INSERT INTO BIT_RichProfDett (BITPR_BITPR_ID, BITPR_MGVR_ID, BITPR_LungRich, BITPR_PzRich, BITPR_DA, BITPR_A, BITPR_DataIns) VALUES',
    b.righe.map((r, i) => `  (@id, ${+r.mgvr}, ${+r.lung}, ${+r.pz}, NULL, NULL, '${d}')${i < b.righe.length - 1 ? ',' : ';'}`).join('\n'),
    '', 'COMMIT;'
  ].join('\n');
}

app.post('/api/richieste', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.mbpc || !b.anno || !b.num || !b.data || !Array.isArray(b.righe) || !b.righe.length)
    return res.status(400).json({ error: 'Dati incompleti: servono cliente, data, numero, anno e almeno una riga.' });
  b.rif = Array.isArray(b.rif) ? b.rif : [];
  const anteprima = sqlAnteprima(b);
  if (!cfg.allowWrite) return res.json({ salvato: false, anteprima,
    messaggio: 'Scrittura disattivata (allowWrite=false in config.json). Nessuna modifica al database.' });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const dup = await new sql.Request(tx)
      .input('anno', sql.Int, +b.anno).input('num', sql.Int, +b.num)
      .query('SELECT COUNT(*) AS n FROM BIT_RichProfAnag WITH (UPDLOCK, HOLDLOCK) WHERE BITPRT_Anno=@anno AND BITPRT_NumOrd=@num');
    if (dup.recordset[0].n > 0) throw new Error(`L'ordine ${b.num}/${b.anno} esiste già.`);
    const pren = await new sql.Request(tx)
      .input('anno', sql.Int, +b.anno).input('num', sql.Int, +b.num)
      .query('SELECT COUNT(*) AS n FROM BIT_PrenotaNumOrd WHERE Anno=@anno AND NumOrd=@num');
    if (pren.recordset[0].n > 0) throw new Error(`Il numero ${b.num}/${b.anno} è riservato da un utente in GestLegno: usa il numero successivo.`);
    const ins = await new sql.Request(tx)
      .input('data', sql.SmallDateTime, new Date(b.data))
      .input('mbpc', sql.Int, +b.mbpc).input('num', sql.Int, +b.num).input('anno', sql.Int, +b.anno)
      .input('ord', sql.Bit, b.ordinario ? 1 : 0)
      .input('r0', sql.VarChar(100), b.rif[0] || null).input('r1', sql.VarChar(100), b.rif[1] || null)
      .input('r2', sql.VarChar(100), b.rif[2] || null)
      .query(`INSERT INTO BIT_RichProfAnag (BITPRT_DATA, BITPRT_MBPC_ID, BITPRT_NumOrd, BITPRT_Anno, BITPRT_Fatt,
                BITPRT_ORDINARIO, BITPRT_IMPEGNATO, BITPRT_Riferimento, BITPRT_Riferimento1, BITPRT_Riferimento2)
              OUTPUT INSERTED.BITRPT_ID AS id
              VALUES (@data, @mbpc, @num, @anno, 0, @ord, 0, @r0, @r1, @r2)`);
    const id = ins.recordset[0].id;
    for (const r of b.righe) {
      await new sql.Request(tx)
        .input('id', sql.Int, id).input('mgvr', sql.Int, +r.mgvr)
        .input('lung', sql.Decimal(18, 3), +r.lung).input('pz', sql.Int, +r.pz)
        .input('data', sql.SmallDateTime, new Date(b.data))
        .query(`INSERT INTO BIT_RichProfDett (BITPR_BITPR_ID, BITPR_MGVR_ID, BITPR_LungRich, BITPR_PzRich, BITPR_DA, BITPR_A, BITPR_DataIns)
                VALUES (@id, @mgvr, @lung, @pz, NULL, NULL, @data)`);
    }
    await tx.commit();
    res.json({ salvato: true, id, anteprima });
  } catch (e) {
    await tx.rollback().catch(() => {});
    res.status(409).json({ error: e.message });
  }
}));

/* ---------- Diagnostica ed export per l'analisi ---------- */
async function diagnostica() {
  const colonne = await q(`
    SELECT t.name AS tabella, c.name AS colonna,
           (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS righe
    FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
    WHERE c.name LIKE '%RPT%' OR c.name LIKE '%RICHPROF%' OR c.name LIKE '%NUMORD%'
    ORDER BY righe DESC, t.name`);
  const tmp = await q(`
    SELECT t.name AS tabella,
           (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS righe
    FROM sys.tables t WHERE t.name LIKE 'BIT[_]TMP%' OR t.name LIKE 'BITPR[_]%' OR t.name LIKE 'BITPLA%'
    ORDER BY t.name`);
  const viste = await q(`SELECT name FROM sys.views WHERE name LIKE 'BIT%' ORDER BY name`);
  const proc = await q(`SELECT name FROM sys.procedures WHERE name LIKE '%BIT%' OR name LIKE '%PROF%' ORDER BY name`);
  const periodoProposte = await q(`
    SELECT MIN(BITPR_DataIns) AS da, MAX(BITPR_DataIns) AS a, COUNT(DISTINCT BITPR_BITRPT_Id) AS richieste
    FROM Bit_ProfiliProposte`);
  return { colonne, tabelleTmp: tmp, viste, procedure: proc, periodoProposte: periodoProposte[0] };
}

app.get('/api/diagnostica', wrap(async (req, res) => res.json(await diagnostica())));

app.post('/api/export', wrap(async (req, res) => {
  const n = Math.min(+req.query.n || 150, 1000);
  // metà recenti, metà tra quelle con proposta salvata (per vedere come il vecchio programma le risolveva)
  const recenti = await listaRichieste({ top: Math.ceil(n / 2) });
  const conProposta = await listaRichieste({ top: Math.floor(n / 2), soloConProposta: true });
  const tutte = [...new Map([...recenti, ...conProposta].map(r => [r.id, r])).values()];
  const richieste = [];
  for (const r of tutte) richieste.push(await dettaglioRichiesta(r.id));

  const mgvr = ids([...new Set(richieste.flatMap(d => d.righe.map(x => x.mgvr)))]);
  const stockAttuale = mgvr.length ? await q(`
    SELECT BITPR_MGVR_ID AS mgvr, BITPR_LUNG AS lung,
           SUM(BITPR_PZ) - SUM(BITPR_PZ_EVA + ISNULL(BITPR_PZIMPEGNATI,0)) AS pz
    FROM BIT_PROFILI WHERE BITPR_MGVR_ID IN (${mgvr.join(',')})
    GROUP BY BITPR_MGVR_ID, BITPR_LUNG
    HAVING SUM(BITPR_PZ) - SUM(BITPR_PZ_EVA + ISNULL(BITPR_PZIMPEGNATI,0)) > 0`) : [];

  const tmpTabelle = (await q(`SELECT name FROM sys.tables WHERE name LIKE 'BIT[_]TMP%' ORDER BY name`)).map(r => r.name);
  const campioniTmp = {};
  for (const t of tmpTabelle) {
    campioniTmp[t] = (await qSafe(`SELECT TOP 30 * FROM [dbo].[${t.replace(/]/g, '')}]`)).rows;
  }
  const campioni = {
    BIT_PROFILI_ultimi: (await qSafe(`SELECT TOP 80 * FROM BIT_PROFILI ORDER BY BITPR_ID DESC`)).rows,
    Bit_ProfiliProposte_ultime: (await qSafe(`SELECT TOP 60 * FROM Bit_ProfiliProposte ORDER BY BITPR_ID DESC`)).rows,
    BIT_PROFILI_impegni_ultimi: (await qSafe(`SELECT TOP 60 * FROM BIT_PROFILI_impegni ORDER BY BITPRIM_ID DESC`)).rows,
    BITPLA_Errori_ultimi: (await qSafe(`SELECT TOP 60 * FROM BITPLA_Errori ORDER BY 1 DESC`)).rows,
    tabelleTmp: campioniTmp
  };

  const out = {
    creato: new Date().toISOString(), database: cfg.db.database,
    diagnostica: await diagnostica(), richieste, stockAttuale, campioni
  };
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const nome = `campione_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  fs.writeFileSync(path.join(EXPORT_DIR, nome), JSON.stringify(out, null, 1));
  res.json({ file: `export/${nome}`, richieste: richieste.length });
}));

app.listen(PORT, cfg.host || '127.0.0.1', () => {
  console.log(`${new Date().toLocaleString('it-IT')} GestLegno Web in ascolto su http://${cfg.host || '127.0.0.1'}:${PORT}` + (ACCESSO.attivo ? ' (accesso con password)' : ' (ACCESSO LIBERO)'));
  console.log(`Database ${cfg.db.database} su ${serverName} - autenticazione ${WINAUTH ? 'Windows' : 'SQL (' + cfg.db.user + ')'}`
    + ` - scrittura ${cfg.allowWrite ? 'ATTIVA' : 'disattivata'}`);
  getPool().then(() => console.log('Connessione al database riuscita' + (driverUsato ? ` (driver ${driverUsato}, server ${serverUsato}).` : '.')))
    .catch(e => console.error('ERRORE connessione database:\n' + testoErrore(e)));
});

/* GestLegno Web - crea l'utente SQL dedicato all'app (invece di usare sa).
   Permessi: lettura e scrittura sui dati del solo database indicato. Nessun permesso amministrativo.

   1. Scegli una password robusta e scrivila qui sotto e in config.json ("db": { "password": ... }).
   2. Correggi @db se il database ha un altro nome.
   3. Esegui in SSMS come amministratore SQL. */

DECLARE @login sysname = N'gestlegno_web';
DECLARE @pwd   nvarchar(128) = N'CAMBIA-QUESTA-PASSWORD';   -- <-- password
DECLARE @db    sysname = N'LEGNOEURO_TEST';                  -- <-- database dell'app

SET NOCOUNT ON;
IF CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS int) = 1
  PRINT N'ATTENZIONE: SQL Server accetta solo l''autenticazione Windows. Per usare questo utente attiva la modalità mista
(SSMS > Proprietà server > Sicurezza > "Autenticazione di SQL Server e di Windows") e riavvia il servizio SQL Server.';

IF @pwd = N'CAMBIA-QUESTA-PASSWORD'
BEGIN
  RAISERROR(N'Imposta una password in @pwd prima di eseguire lo script.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @login)
  EXEC (N'CREATE LOGIN ' + N'[' + @login + N'] WITH PASSWORD = N''' + @pwd + N''', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [' + @db + N']');
ELSE
  EXEC (N'ALTER LOGIN [' + @login + N'] WITH PASSWORD = N''' + @pwd + N'''');

DECLARE @sql nvarchar(max) = N'USE ' + QUOTENAME(@db) + N';
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N''' + @login + N''')
  CREATE USER ' + QUOTENAME(@login) + N' FOR LOGIN ' + QUOTENAME(@login) + N';
ALTER ROLE db_datareader ADD MEMBER ' + QUOTENAME(@login) + N';
ALTER ROLE db_datawriter ADD MEMBER ' + QUOTENAME(@login) + N';';
EXEC (@sql);
PRINT N'Utente ' + @login + N' pronto su ' + @db + N' (lettura e scrittura dati).';

/* Quando si passerà al database di produzione, eseguire di nuovo lo script con @db = N'LEGNOEURO'.
   Se in futuro l'app userà le stored procedure BIT_* servirà anche:
   USE LEGNOEURO; GRANT EXECUTE TO [gestlegno_web]; */

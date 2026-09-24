-- Column-level DENY for the API's read-only login: SQL Server itself refuses to
-- return credentials, even to "SELECT *" or hand-written SQL. Safe to re-run.
--
-- Only credential columns are denied here. A column DENY also makes SQL Server
-- refuse COUNT(*) on that whole table, so identity numbers (CNIC/SSN) in busy
-- tables like Customer are protected by the API instead (DB_DENY_COLUMNS: hidden
-- from the model, rejected by name, and SELECT * is refused).
USE [$(DB_NAME)];
GO
DECLARE @sql nvarchar(max) = N'';
SELECT @sql += N'DENY SELECT ON ' + QUOTENAME(s.name) + N'.' + QUOTENAME(o.name) + N' (' + QUOTENAME(c.name) + N') TO ' + QUOTENAME(N'$(READER_LOGIN)') + N';' + CHAR(10)
FROM sys.columns c
JOIN sys.objects o ON o.object_id = c.object_id AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE c.name LIKE N'%password%' OR c.name LIKE N'%passwd%' OR c.name LIKE N'%pwd%'
   OR c.name LIKE N'%secret%' OR c.name LIKE N'%token%';
PRINT @sql;
EXEC sys.sp_executesql @sql;
GO

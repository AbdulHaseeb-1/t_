-- Torture-test database for the MDF reader (apps/server/src/mdf). Every storage
-- feature the reader claims to support, with edge values. Build it, take it
-- offline, copy the .mdf, then:
--   pnpm --filter server mdf -- import MdfFixture.mdf out.duckdb --verify-db MdfFixture
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
IF DB_ID('MdfFixture') IS NOT NULL BEGIN ALTER DATABASE MdfFixture SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE MdfFixture; END;
GO
CREATE DATABASE MdfFixture COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
USE MdfFixture;
GO
CREATE TABLE dbo.AllTypes (
  id int NOT NULL PRIMARY KEY,
  ti tinyint, si smallint, i int, bi bigint,
  b1 bit, b2 bit, b3 bit, b4 bit, b5 bit, b6 bit, b7 bit, b8 bit, b9 bit, b10 bit,
  d5 decimal(5,2), d18 decimal(18,6), d38 decimal(38,10), n9 numeric(9,0),
  m money, sm smallmoney, f float, r real,
  dt datetime, sdt smalldatetime, dte date, dt2 datetime2(7), dt20 datetime2(0), t3 time(3), t7 time(7), dto datetimeoffset(7),
  g uniqueidentifier,
  c char(10), vc varchar(50), nc nchar(10), nvc nvarchar(50),
  bin binary(4), vbin varbinary(20),
  vmax varchar(max), nvmax nvarchar(max), vbmax varbinary(max),
  txt text, ntxt ntext, img image
);
GO
DECLARE @k1 varchar(max) = REPLICATE(CONVERT(varchar(max), 'Ali 0123456789 '), 70);        -- ~1 KB (in row)
DECLARE @k20 varchar(max) = REPLICATE(CONVERT(varchar(max), 'Karachi-Lahore-Multan '), 1000); -- 22 KB (inline root, level 0)
DECLARE @m1 varchar(max) = REPLICATE(CONVERT(varchar(max), 'x1234567890'), 100000);         -- 1.1 MB (internal nodes)
INSERT dbo.AllTypes VALUES
 (1, 0, -32768, -2147483648, -9223372036854775808, 1,0,1,0,1,0,1,0,1,1,
  -999.99, 123456789012.123456, -1234567890123456789012345678.0123456789, 999999999,
  -922337203685477.5808, -214748.3648, -1.7976931348623157E+308, -3.4028235E+38,
  '1753-01-01 00:00:00.000', '1900-01-01 00:00', '0001-01-01', '0001-01-01 00:00:00.0000000', '2000-02-29 23:59:59', '00:00:00.000', '23:59:59.9999999', '0001-01-01 00:00:00.0000000 -14:00',
  '00000000-0000-0000-0000-000000000000',
  'a', '', N'پاکستان', N'', 0x00000000, 0x,
  '', N'', 0x, '', N'', 0x),
 (2, 255, 32767, 2147483647, 9223372036854775807, 0,1,0,1,0,1,0,1,0,0,
  999.99, -0.000001, 9999999999999999999999999999.9999999999, -1,
  922337203685477.5807, 214748.3647, 2.2250738585072014E-308, 1.17549435E-38,
  '9999-12-31 23:59:59.997', '2079-06-06 23:59', '9999-12-31', '9999-12-31 23:59:59.9999999', '2026-09-24 10:11:12', '12:34:56.789', '00:00:00.0000001', '9999-12-31 23:59:59.9999999 +14:00',
  'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
  'Café €uro', 'naïve – “quotes”', N'کراچی', N'اردو ہے جس کا نام', 0xDEADBEEF, 0x0102030405,
  @k1, N'آپ کے ' + REPLICATE(CONVERT(nvarchar(max), N'بیس گاہک ہیں۔ '), 800), CONVERT(varbinary(max), @k20),
  @k20, N'مختصر', CONVERT(varbinary(max), @m1)),
 (3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
 (4, 7, 7, 7, 7, 1,1,1,1,1,1,1,1,1,1,
  0.01, 0.5, 0.0000000001, 0, 0.0001, 0.0001, 3.141592653589793, 2.5,
  '2026-01-01 00:00:00.003', '2026-01-01 12:30', '2026-01-01', '2026-01-01 00:00:00.1234567', '2026-01-01 00:00:01', '01:02:03.004', '01:02:03.0040005', '2026-01-01 05:00:00.0000000 +05:00',
  '6F9619FF-8B86-D011-B42D-00C04FC964FF',
  'x', LEFT(@k1, 50), N'x', N'x', 0x01, 0xFF,
  @m1, N'x', CONVERT(varbinary(max), @m1),
  @m1, REPLICATE(CONVERT(nvarchar(max), N'ن'), 5000), 0xFF);
GO
-- Row overflow: two 5,000-char columns cannot both stay in an 8 KB row.
CREATE TABLE dbo.Overflow (id int PRIMARY KEY, a varchar(5000), b varchar(5000), n nvarchar(3000));
INSERT dbo.Overflow VALUES (1, REPLICATE('a', 5000), REPLICATE('b', 5000), REPLICATE(N'ن', 3000)), (2, 'short', NULL, N'x');
GO
-- Heap with forwarded records (rows grown by UPDATE move off their page) and ghosts.
CREATE TABLE dbo.HeapFwd (id int NOT NULL, v varchar(2000));
DECLARE @i int = 1;
WHILE @i <= 400 BEGIN INSERT dbo.HeapFwd VALUES (@i, 'v'); SET @i += 1; END;
UPDATE dbo.HeapFwd SET v = REPLICATE('w', 1500) WHERE id % 3 = 0;
DELETE dbo.HeapFwd WHERE id % 7 = 0;
GO
-- Schema evolution: dropped column, columns added after rows existed.
CREATE TABLE dbo.Evolved (id int PRIMARY KEY, keep1 int, gone varchar(20), keep2 varchar(20));
INSERT dbo.Evolved VALUES (1, 10, 'x', 'a'), (2, 20, 'y', NULL);
ALTER TABLE dbo.Evolved DROP COLUMN gone;
ALTER TABLE dbo.Evolved ADD added_null int NULL;
ALTER TABLE dbo.Evolved ADD added_default int NOT NULL CONSTRAINT DF_Evolved_added DEFAULT 42;
ALTER TABLE dbo.Evolved ADD added_text varchar(10) NOT NULL CONSTRAINT DF_Evolved_text DEFAULT 'def';
INSERT dbo.Evolved (id, keep1, keep2, added_null, added_default, added_text) VALUES (3, 30, 'c', 5, 7, 'new');
GO
-- Computed columns, another schema, composite keys and a foreign key.
CREATE SCHEMA sales;
GO
CREATE TABLE sales.Orders (
  shop int NOT NULL, order_no int NOT NULL, qty int NOT NULL, price decimal(10,2) NOT NULL, pct decimal(5,2) NULL,
  total AS (CONVERT(decimal(15,2), qty * price - (isnull(pct, 0) / 100.0) * (qty * price))),
  total_p AS (qty * price) PERSISTED,
  item int NULL REFERENCES dbo.AllTypes(id),
  CONSTRAINT PK_Orders PRIMARY KEY (shop, order_no)
);
INSERT sales.Orders (shop, order_no, qty, price, pct, item) VALUES (1, 1, 3, 119.99, 12.5, 1), (1, 2, 1, 0.05, 50, NULL), (2, 1, 7, 10.15, NULL, 2);
GO
-- Non-unique clustered index (hidden uniqueifier column).
CREATE TABLE dbo.Dups (k int NOT NULL, v varchar(10));
CREATE CLUSTERED INDEX CX_Dups ON dbo.Dups (k);
INSERT dbo.Dups VALUES (1, 'a'), (1, 'b'), (1, 'c'), (2, NULL);
GO
CHECKPOINT;
GO

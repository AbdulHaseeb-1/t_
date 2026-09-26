# Connecting Ask Data to your database

This guide takes you from the APK to asking questions of your own SQL Server database, in Urdu, Roman Urdu or English. It was validated against `MDS_EPD`, the pharmacy-distribution ERP database from `MDS_EPD_SQL16.mdf`.

## 1. How the pieces fit

```
 Phone (Ask Data APK)  --HTTP-->  Ask Data server (Node.js)  --TDS 1433-->  SQL Server (MDS_EPD)
                                         |
                                         +--HTTPS-->  OpenAI (question -> SQL, answer wording, voice, photos)
```

- **The phone never connects to the database.** The database password and the OpenAI key stay on the server. The phone stores only the server address and an optional API key, in the Android Keystore.
- **The server needs** Node.js, network access to SQL Server, and outbound HTTPS to `api.openai.com`.
- **Placement:** run the server on the SQL Server machine itself or on any PC or VM that can reach it. In a single-office setup, one Windows PC runs both.

> Correction to an earlier assumption: `MDS_EPD` is **not** Microsoft Master Data Services. It is an ERP with 81 tables and 23 views in `dbo`, covering invoices, customers, products, companies, stock, receipts and ledgers. Everything below reflects the real schema.

## 1b. Choose how the server reads your data

| | **Option A: live SQL Server** (sections 2–3) | **Option B: read the .mdf directly** (section 2B) |
|---|---|---|
| Needs SQL Server installed | Yes | **No** |
| Data freshness | Live, every query | As fresh as the last .mdf copy (e.g. nightly) |
| Setup | Login, TCP/IP, firewall | Point the server at a copy of the .mdf |
| Speed on analytics | Good | Faster (column store); your DB shrinks to ~17 MB |
| Read-only guarantee | Read-only login + SQL guard + rolled-back transaction | File opened read-only + DuckDB read-only + external access off + SQL guard |

Pick A when answers must reflect the last minute. Pick B to run without SQL Server on the server machine, or to keep the query load off the ERP's database.

## 2. Option A: create a read-only login in SQL Server (5 minutes)

Run this in SSMS as an administrator, with your own strong password:

```sql
USE master;
CREATE LOGIN db_intel_reader WITH PASSWORD = 'Use-A-Long-Unique-Passw0rd!', CHECK_POLICY = ON;
GO
USE MDS_EPD;
CREATE USER db_intel_reader FOR LOGIN db_intel_reader;
ALTER ROLE db_datareader ADD MEMBER db_intel_reader;   -- read-only: SQL Server itself refuses writes
GO
```

Then deny the credential columns at the database level. Run `infra/mssql/harden.sql` in SSMS with SQLCMD mode on (Query → SQLCMD Mode), after setting:

```
:setvar DB_NAME MDS_EPD
:setvar READER_LOGIN db_intel_reader
```

The server must be able to reach SQL Server over TCP:

1. **SQL Server Configuration Manager** → *SQL Server Network Configuration* → *Protocols* → enable **TCP/IP**, then restart the SQL Server service.
2. **SSMS** → server *Properties* → *Security* → **SQL Server and Windows Authentication mode**.
3. **Windows Firewall:** allow inbound TCP **1433**. This is only needed when the Ask Data server runs on a different machine from SQL Server.
4. **Named instance** (for example `PC\SQLEXPRESS`): give the instance a fixed TCP port in Configuration Manager (*TCP/IP → IP Addresses → IPAll → TCP Port*, e.g. 1433) and use that port.

The database has no MDF yet? `infra/mssql/attach.sh` attaches `MDS_EPD_SQL16.mdf` into a SQL Server 2022 container and creates the same login automatically (Docker required).

## 2B. Option B: no SQL Server, read the .mdf file directly

The server includes its own reader for SQL Server data files. It reads the pages of the `.mdf`, rebuilds every table (including keys, relationships and computed columns such as `InvoiceDetail.total_net`) and writes a read-only [DuckDB](https://duckdb.org) file that the AI queries.

```
MDS_EPD_SQL16.mdf  --(built-in MDF reader, read-only)-->  mds.duckdb  --(read-only)-->  AI-generated SELECT  -->  answer
```

**1. Get a consistent copy of the .mdf.** SQL Server keeps attached databases' files locked, and a copy of a running file can be inconsistent. Use one of:
- The ERP's SQL Server Management Studio: right-click the database → *Tasks → Take Offline*, copy the `.mdf`, then *Bring Online*. This takes a few seconds.
- A backup restored on another machine, then that restored database's `.mdf`.
- A file already detached, such as the one you shared.

Only the `.mdf` is needed (no `.ldf`). The reader supports SQL Server 2016 and newer data files, single-file databases (no `.ndf`), without table compression.

**2. Configure the server** (in `.env`, see `infra/mssql/mds-epd.env.example`):

```
DB_ENGINE=duckdb
MDF_IMPORT_PATH=D:\erp-copy\MDS_EPD_SQL16.mdf      # the copy from step 1
DUCKDB_FILE=data/mds.duckdb                           # created automatically
MDF_IMPORT_EXCLUDE=dbo.AuditTrail*,dbo.Users,dbo.UserGroup,dbo.UserSession,dbo.Organization,dbo.ErrorLog,dbo.BackupHistory
```

On start, the server converts the file (about 11 seconds for your 364 MB database) and serves questions from `data/mds.duckdb`. Password, token and CNIC columns (`DB_DENY_COLUMNS`) are never copied. Excluded tables are not copied at all.

**3. Refresh with new data.** Replace the `.mdf` copy (for example with a nightly scheduled task), then call:

```bash
curl -X POST http://localhost:3000/schema/refresh -H "x-api-key: <API_KEY>"
```

The server converts the newer file and switches to it without a restart. Queries in progress finish on the previous data.

**Manual conversion and checking** (optional):

```bash
pnpm --filter server mdf inspect path/to/file.mdf                 # tables, keys, relationships
pnpm --filter server mdf import path/to/file.mdf data/mds.duckdb   # convert
# if the same database is also attached to a SQL Server, compare every value:
pnpm --filter server mdf import file.mdf data/mds.duckdb --verify-db MDS_EPD
```

How it was verified on your database: all 81 tables and 376,124 rows were compared cell by cell with SQL Server and are byte-identical, including off-row text, recomputed columns and tables with dropped columns. The 40 reference questions return identical results on both engines, and AI accuracy on the DuckDB engine was 99.2% (40 questions × 3 runs). The one miss answered "August" where the reference expects month number 8.

## 3. Install and configure the server

On the machine that will run the server (Windows, macOS or Linux):

```bash
# prerequisites: Node.js 22 LTS, pnpm 10 (npm i -g pnpm), git
git clone <this repository> ask-data && cd ask-data
pnpm install
cp infra/mssql/mds-epd.env.example .env      # tuned settings for MDS_EPD (Option A or B inside)
```

Edit `.env` and fill in:

| Setting | Value |
|---|---|
| `DB_HOST` | `localhost` if SQL Server is on the same machine, else its IP (e.g. `192.168.1.10`) |
| `DB_PORT` | `1433`, or the fixed port of your named instance |
| `DB_PASSWORD` | the `db_intel_reader` password from step 2 |
| `OPENAI_API_KEY` | your OpenAI key. Keep it only in `.env`, never in chats, screenshots or commits. |
| `API_KEY` | a random secret the app must send (the server refuses to start in production without one). Generate: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |

Build and start:

```bash
pnpm --filter server build
pnpm start                                   # listens on port 3000
```

Check it from the same machine:

```bash
curl http://localhost:3000/health
# {"status":"ok","db":{"ok":true,...},"llm":{"configured":true,"mode":"openai"}}
```

The first start reads the schema, about 88 objects after the exclusions, and caches it. Run `curl -X POST http://localhost:3000/schema/refresh -H "x-api-key: <API_KEY>"` after any schema change.

**Keep it running after reboots:**
- Windows: `npm i -g pm2 pm2-windows-startup && pm2-startup install && pm2 start "pnpm start" --name ask-data && pm2 save`
- Linux: `pm2 start "pnpm start" --name ask-data && pm2 startup && pm2 save`, or run the Docker service in `infra/docker-compose.yml`.

## 4. Connect the phone

1. Copy `AskData-1.0.0.apk` to the phone and open it. Android asks once to allow installs from that source (Files, Chrome or WhatsApp).
2. Open **Ask Data**. The first screen says **Connect your server** (اپنا سرور منسلک کریں). Tap the button.
3. **Server address:** the server PC's address as the phone sees it, e.g. `http://192.168.1.20:3000`. Find it with `ipconfig` on Windows (IPv4 Address) or `ip addr` on Linux. `localhost` does not work from a phone.
4. **API key:** the `API_KEY` from `.env`.
5. Tap **Test connection**. You should see *Connected. Database is up*. Then tap **Save**.
6. Optional: under **Reply language**, choose **Roman Urdu** to get answers like *"Ap k 1,050 customers hain."* **Auto** answers in the language of each question.

You can change the address at any time in **Settings** (☰ → Settings). If the server can't be reached, the error message has an **Open settings** button.

The phone and the server must be on the same Wi-Fi/LAN, or see section 5.

## 5. Using it outside the office

Do not forward port 3000 on your router. Pick one of these:

| Option | Effort | Result |
|---|---|---|
| **Tailscale** (recommended) | Install on the server PC and the phone, same account | Private address like `http://100.x.y.z:3000` that works anywhere; nothing exposed to the internet |
| **Cloudflare Tunnel** | `cloudflared tunnel --url http://localhost:3000` | Public `https://…trycloudflare.com` URL; keep `API_KEY` set |
| VPS/cloud server | Deploy the server next to a replicated database | For many users; needs a VPN or firewall rule to SQL Server |

The app accepts both `http://` (LAN, Tailscale) and `https://` addresses.

## 6. What was tested on your database

Test set `apps/server/eval/datasets/mds-epd.json`: 40 real questions (21 English, 9 Urdu script, 10 Roman Urdu; 6 phrased naturally with no column hints). Each has hand-verified gold SQL, and a run passes only when the generated SQL returns the same rows.

| Stage | Accuracy (3 runs each; 34 questions, final row 40) | What changed |
|---|---|---|
| First run on MDS_EPD | 95.6% | baseline system |
| + reasoning-token headroom | 97.1% | escalated calls no longer returned empty SQL |
| + composite keys and named-table retrieval | 98.0% | `Company` always found; `PK(area_id, town_id)` shown |
| + schema notes and report views hidden | **100%** (40/40, every run) | sales totals come from `InvoiceLine`, not line-level views |

Cost: about **$0.00012 per question**, roughly 8,000 questions per US$1. Median latency is 1.2–1.8 s. Voice and photo questions add about 2–4 s.

Examples of live answers from your data:

- *hamare kitne customers hain?* → **Ap k 1,050 customers hain.**
- *2026 mein sab se zyada sale kis mahine mein hui?* → **August**, 3,784,681
- *top 3 booking man kon hain net sale ke hisab se?* → a ranked table of booking-man names with 22,137,330 · 1,354,256 · 1,031,092
- *sab se zyada udhaar kis area ke customers par hai?* → BHAGTANWALA, 5,215,270

## 7. Privacy and safety controls (on by default)

| Layer | Protection |
|---|---|
| SQL Server | `db_datareader` only; credential columns denied (`harden.sql`) |
| Server, before every query | Single `SELECT` only; write, DDL and exec keywords refused; `SELECT *` refused; denied columns (`*password*`, `*cnic*`, `*ssn*`, `*token*` …) rejected by name; row cap and timeout; runs inside a rolled-back transaction |
| What the model sees | Table and column names only, plus sample values for low-cardinality code columns (e.g. `catagory {R\|O\|I\|D}`). Names, phones, addresses, GPS, cheque numbers and audit users are never sampled. |
| App | Server key in Android Keystore; no database credentials on the phone |
| Network | `API_KEY` required once exposed; per-IP rate limits |

The model never sees full tables. It sees question-relevant result rows only when it writes the answer text, capped at a small sample. Nothing is used for training under OpenAI's API terms.

## 8. Tuning for your data (optional, high value)

- **`infra/mssql/mds-epd.schema-notes.json`** holds short notes the model reads, such as *"InvoiceLine: one row per invoice; sales totals: SUM(net_amt)"*. Add a note whenever an answer uses the wrong table or column. This is the cheapest accuracy lever there is. Restart the server afterwards.
- **`SCHEMA_EXCLUDE`** hides tables and views the model should never use.
- **Add your own test questions** to `mds-epd.json` and run
  `pnpm --filter server eval --dataset eval/datasets/mds-epd.json --repeat 3`.
  It prints a plain-text scorecard and saves `report.txt`. Re-run it after every change.
- Known limit: `Customer.catagory` codes (R/O/I/D) have no stored meaning. Add a note with what each code means and the model will use it.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| App: *Can't reach the server* | Phone and server on the same network? Correct IP? Windows Firewall must allow TCP 3000 (`netsh advfirewall firewall add rule name="Ask Data" dir=in action=allow protocol=TCP localport=3000`). |
| App: *API key was rejected* | The key in the app must equal `API_KEY` in `.env`. |
| `/health` shows `db.ok: false`, "Login failed" | Wrong `DB_PASSWORD`, or SQL authentication mode is off (step 2.2). |
| `db.ok: false`, "Could not connect" / timeout | TCP/IP disabled, wrong `DB_PORT` for a named instance, or firewall on 1433. |
| `llm.configured: false` | `OPENAI_API_KEY` missing in `.env`. |
| Answers "Too many requests" | OpenAI rate limit on your account tier; wait, or add `OPENROUTER_API_KEY` as automatic fallback. |
| Voice message not understood | Speak within 2 minutes; the server needs an OpenAI key for transcription. |
| Wrong number for a business question | Add a schema note (section 8) and a test case; re-run the eval. |

## 10. Updating the app

Future APKs must be signed with the same key, or Android refuses the update. Keep `askdata-release.keystore` and its password (delivered separately, never committed) in a password manager. Build a new version with:

```bash
cd apps/mobile
# bump "version" and android.versionCode in app.json
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease     # signing: see plugins/withReleaseSigning.js
```

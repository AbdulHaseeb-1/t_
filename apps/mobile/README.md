# Datalink (mobile)

A focused conversational client for the db-intelligence server: ask questions in plain language, get answers from your database, and open the SQL and rows behind any answer.

Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript. Runs on iOS, Android and the web.

## Run

```bash
pnpm install                     # from the repo root
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your-computer-ip>:3000 pnpm start
```

On a physical phone, the server address must be your computer's LAN address, not `localhost`. It can also be changed in the app under **Settings**. The server must allow the web origin in `CORS_ORIGINS` when you use the web build.

Release builds ship **without** a server address. On first launch the app shows *Connect your server* and opens Settings. Step-by-step setup with your own database: [docs/CONNECT-DATABASE.md](../../docs/CONNECT-DATABASE.md).

## What's on screen (and nothing else)

- **Header**: conversation list, title, a **token usage pill** (tokens used in this conversation; tap for input/cached/output tokens, cost and where the time went), new chat.
- **Thread**: your questions as bubbles, answers in a reading serif. Each answer ends with a meta line (`1.4 s · 1.9K Tokens`, or `Cache`). Tap it for **answer details**:
  - **time split**: model vs database vs speech/image vs other, as one stacked bar
  - **tokens**: input (with the cached part), output and cost, then the same per model call (SQL, answer, recheck, transcription…)
  - **cache**: fresh, SQL cache or answer cache, and how many attempts it took
  - **context**: whole schema or the N retrieved tables (with its token size), earlier turns sent, and the engine (SQL Server or converted `.mdf`)
- **Charts**: the data's shape picks the form, never a fixed chart type:
  - one row of 2-4 numbers: **KPI tiles**
  - ≤ 12 periods: **growth columns**, with the latest period highlighted, change vs the previous one and since the first (month + year columns become `Jan`, `Dec 25`, …)
  - longer or multi-series time: a **trend line** with an area wash, peak marker and crosshair
  - "share / distribution" questions with ≤ 6 parts: a **donut**. When the query returns its own percentage column, the rest of the whole becomes an "Other" slice, so the chart matches the answer's percentages.
  - categories: **ranked bars** with each item's share
  - Tapping a mark shows its value. A percentage column is never drawn on the same axis as the amount it came from. Ids, ambiguous labels and too many points stay a table.
- **Data panel**: all returned rows, 25 per page with Previous and Next controls. The panel explains when the server's `DB_MAX_ROWS` cap was reached. The SQL is **hidden by default**. Turn on *Settings → Show SQL queries* to see the query too.
- **Composer**: text, voice and photo in one box. The primary button is context-aware: **mic** when empty, **send** with content, **stop** while a request is in flight. Recording shows a pulsing dot, a timer and a live waveform from the microphone level, with trash (discard) and send. A subtle haptic marks a completed response. On the web, Enter sends and Shift+Enter adds a line.
- **Drawer**: new chat, **Reports**, **Schedules**, **Inbox** (with an unread count), recent conversations (long-press to delete), settings. The header bell opens the inbox too.
- **Reports**: a searchable gallery of one-tap reports grouped by category (sales, stock, customers, finance, team, saved). The server's template file supplies them, with SQL verified in advance, so a report returns the same figures every time and only the short summary uses the model. Reports with a date or number show a sheet with presets first: *Today*, *Yesterday*, *This week*, *This month*, *Last month*, or a custom date. Up to two alert reports (such as stock shortage) and two quick ones also appear as chips on the empty chat screen. Any AI answer with SQL can be kept with **Save as report**. Long-press a saved report to delete it.
- **Schedules**: run a report or a question daily, on chosen weekdays, or on a day of the month (including the last day), at a set time in the server's time zone. Each schedule can:
  - deliver to the app inbox, to WhatsApp numbers, or both
  - send *only when there are rows*, so alert reports stay quiet on good days
  - be paused with a switch, or tested with **Run now**
- **Inbox**: every delivered report with its answer, chart, data and delivery status per recipient, plus **Run report** to refresh it into a chat.
- **Notifications**: the app checks the inbox on open, every minute while in use, and about every 15 minutes in the background (`expo-background-task`). New reports show as local notifications. Tapping one opens the report. The first check after install does not replay old reports. Remote push through Expo is used instead when the build has an EAS project ID and FCM credentials.
- **Settings**: grouped cards with a large title, in the style of a native settings screen:
  - **Connection**: the server row opens the address and optional API key (kept in the device keychain), with **Test connection**, which reports reachability, database, model and key status separately.
  - **Language**: *App language* (English, the default, or Urdu) and *Reply language* (Auto, Urdu script, Roman Urdu such as *"Ap k 20 customers hain."*, or English), each on its own picker page.
  - **Chat**: *Show SQL queries*, and sounds and vibration.
  - Connection errors offer an **Open settings** shortcut straight to the server page.

Urdu is first-class: right-to-left layout, Noto Nastaliq Urdu for Urdu text, Urdu month names on chart axes, and each message's script detected on its own, so mixed chats render correctly.

Follow-up questions ("and for 2024?") work: the last four answered turns are sent as context.

## Design

The interaction model and typographic scale follow a calm, conversation-first chat layout. Fonts are open-licensed stand-ins bundled with the app: **Source Serif 4** for answers and **DM Sans** for the interface. The reference app's proprietary typefaces, name and logo are deliberately not used.

| Role | Face | Size / line height |
|---|---|---|
| Answer prose | Source Serif 4 | 16.5 / 26 |
| Messages, input | DM Sans | 16 / 23 |
| Header title | DM Sans SemiBold | 16 / 22 |
| Meta, tables | DM Sans | 13 / 18 |

Light and dark themes follow the system setting.

**Brand:** the connected D mark is defined in `scripts/brand.mjs`. It renders the launcher icon, Android adaptive icons, splash image and favicon. `src/components/RouteMark.tsx` draws the same geometry natively. The interface uses cool ink and mint surfaces in light and dark modes.

## Performance

- The message list is virtualized and inverted. Rows are memoized on message identity, and the reducer only replaces messages that changed.
- The composer owns its text state, so typing never re-renders the conversation (enforced by a test).
- Markdown parsing is memoized per message. The parser is a small purpose-built module (400-row table < 50 ms).
- Chats persist with a debounced write, one stored value per conversation, and only changed conversations are rewritten. A value that cannot be read is left untouched, never saved over. Stored results keep up to 250 rows each (fewer if a conversation would exceed Android's ~2 MB read window); the table says when a full result must be asked again. Histories saved by older versions move to the new format on first launch.
- Fonts are imported per weight. The package roots would ship every weight: 6.8 MB instead of 2.5 MB on the web.

Measured in the web build (Chromium, 390×844): cold start to interactive **~100 ms**, opening a 240-message chat **~420 ms** with 5 rows mounted, **0** long tasks while typing.

## Tests

```bash
pnpm typecheck && pnpm lint && pnpm test   # 79 unit + integration tests (Jest, mocked network)
```

The integration tests render the real router, screens and stores. They cover:

- the full ask flow, follow-up context, stop and retry
- server errors and the Open-settings shortcut
- voice and photo questions
- the Urdu interface
- Roman Urdu replies
- settings opened directly (deep link)
- drawer switching, delete, and persistence across restarts
- the typing-isolation check
- reports: running a report from the gallery and from a chip, parameters, saving an answer as a report, the schedule editor, the inbox, and notification checks without replaying old reports

End to end against a live server (real database and LLM):

```bash
pnpm build:web                                  # EXPO_PUBLIC_API_URL=http://localhost:3000
python3 -m http.server 8090 --directory dist    # or any static server
# server: CORS_ORIGINS=http://localhost:8090 DB_NAME=Eval_Retail
pnpm test:e2e                                   # PW_CHROMIUM=/path/to/chromium if needed
```

14 Playwright scenarios run at phone size. They check answers against ground-truth values in the `Eval_Retail` fixture. They cover follow-ups, reload persistence, stop and retry, recovery from a wrong server address, Roman Urdu replies, hidden-by-default SQL, the usage and answer-details sheets, dark mode, the Urdu interface, real voice and photo questions, charts, and performance budgets.

## Android release APK

```bash
npx expo prebuild -p android --clean
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
cd android && ./gradlew assembleRelease     # -> app/build/outputs/apk/release/app-release.apk
```

- **Signing:** `plugins/withReleaseSigning.js` signs with your upload key when `ASKDATA_UPLOAD_*` properties are set in `~/.gradle/gradle.properties`, and falls back to the debug key otherwise. Keep the keystore out of git (`credentials/` is ignored). Updates must be signed with the same key.
- **Build settings:** cleartext HTTP is allowed so LAN servers (`http://192.168.x.x:3000`) work. The APK targets ABIs `arm64-v8a` and `armeabi-v7a`, with no background-audio service and no biometric permissions (`expo-build-properties`, `blockedPermissions`).
- **Native modules:** notifications and background checks (`expo-notifications`, `expo-background-task`) are native, so an APK built before them must be rebuilt; an over-the-air JavaScript update is not enough.
- **Verification:** the release APK was verified statically (signature, manifest, permissions, bundle contents). The build container has no Android emulator (no KVM), so on-device behaviour was verified through the same JavaScript on the web target and in Jest. Microphone, haptics and splash on real hardware should get a smoke test on your phone.

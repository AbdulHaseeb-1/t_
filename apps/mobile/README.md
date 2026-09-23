# Ask Data (mobile)

A focused conversational client for the db-intelligence server: ask questions in plain language, get answers from your database, and open the SQL and rows behind any answer.

Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript. Runs on iOS, Android and the web.

## Run

```bash
pnpm install                     # from the repo root
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your-computer-ip>:3000 pnpm start
```

On a physical phone, the server address must be your computer's LAN address, not `localhost`. It can also be changed in the app under **Settings**. The server must allow the web origin in `CORS_ORIGINS` when you use the web build.

## What's on screen (and nothing else)

- **Header**: conversation list, title, new chat.
- **Thread**: your questions as bubbles, answers in a reading serif. Tables and lists render natively. Each answer has a **Query** disclosure with the exact SQL, row count, timing and the first 50 rows, plus copy and ask-again.
- **Composer**: grows with the text. Send becomes **Stop** while a request is in flight. On the web, Enter sends and Shift+Enter adds a line.
- **Drawer**: new chat, recent conversations (long-press to delete), settings.
- **Settings**: server address and optional API key (kept in the device keychain), with **Test connection**, which reports reachability, database, model and key status separately.

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

## Performance

- The message list is virtualized and inverted. Rows are memoized on message identity, and the reducer only replaces messages that changed.
- The composer owns its text state, so typing never re-renders the conversation (enforced by a test).
- Markdown parsing is memoized per message. The parser is a small purpose-built module (400-row table < 50 ms).
- Chats persist with a debounced write, and stored results are capped at 100 rows.
- Fonts are imported per weight. The package roots would ship every weight: 6.8 MB instead of 2.5 MB on the web.

Measured in the web build (Chromium, 390×844): cold start to interactive **~100 ms**, opening a 240-message chat **~420 ms** with 5 rows mounted, **0** long tasks while typing.

## Tests

```bash
pnpm typecheck && pnpm lint && pnpm test   # 28 unit + integration tests (Jest, mocked network)
```

The integration tests render the real router, screens and stores. They cover the full ask flow, follow-up context, stop and retry, server errors, drawer switching, delete, persistence across restarts, and the typing-isolation check.

End to end against a live server (real database and LLM):

```bash
pnpm build:web                                  # EXPO_PUBLIC_API_URL=http://localhost:3000
python3 -m http.server 8090 --directory dist    # or any static server
# server: CORS_ORIGINS=http://localhost:8090 DB_NAME=Eval_Retail
pnpm test:e2e                                   # PW_CHROMIUM=/path/to/chromium if needed
```

7 Playwright scenarios run at phone size. They check answers against ground-truth values in the `Eval_Retail` fixture and cover follow-ups, reload persistence, stop and retry, recovery from a wrong server address, dark mode, and performance budgets.

Native builds (`npx expo run:ios|android` or EAS) were not exercised in the development container. Everything above ran on the web target and in Jest.

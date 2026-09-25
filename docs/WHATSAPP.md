# WhatsApp bot

The server answers WhatsApp messages the same way the app does, and can send scheduled reports to WhatsApp numbers. It uses Meta's **WhatsApp Cloud API** directly, with no third-party gateway.

## What users can do

| They send | They get |
|---|---|
| A question as text (Urdu, Roman Urdu or English) | The answer, key figures and a small table, from the same pipeline as the app |
| A voice note | It is transcribed, then answered |
| A photo (a handwritten question, an invoice, a screenshot) | It is read by the vision model, then answered |
| `reports`, `menu`, `help`, `salam`, `رپورٹس`, `مینو` | A tap-to-run list of the report templates (nine per page, then "More") |
| `new`, `reset`, `نیا` | A fresh conversation (follow-up questions otherwise keep the last 4 turns for 30 minutes) |

Replies use the language of the question. Long results are cut to WhatsApp's 4,096-character limit, with the row count stated.

## Security

- **Allow-list.** Only numbers in `WHATSAPP_ALLOWED_NUMBERS` reach the database. Everyone else gets a single polite refusal and is then ignored. An empty list lets nobody in. `*` lets everyone in; do not use it with real business data.
- **Signed webhooks.** Every POST is checked against `X-Hub-Signature-256`, an HMAC of the raw body computed with `WHATSAPP_APP_SECRET`. Unsigned or forged calls get 403.
- **Replays.** Meta retries deliveries, so message IDs are de-duplicated and a question is never answered twice.
- **The same read-only guard.** The SQL guard, read-only login and denied columns apply exactly as they do for the app.

## Setup (about 20 minutes)

You need a Meta (Facebook) account, a Meta Business portfolio, and a phone number that is **not** already registered on the WhatsApp or WhatsApp Business app. Meta also gives you a free test number to start with.

1. **Create the app.** At <https://developers.facebook.com/apps>, choose *Create app*, pick the *Business* use case, and add the **WhatsApp** product.
2. **Get the IDs.** Open *WhatsApp → API Setup*. Copy the **Phone number ID** (not the phone number itself) into `WHATSAPP_PHONE_NUMBER_ID`. With the test number, add up to five recipient numbers here and verify them.
3. **Get a permanent token.** The token shown on API Setup expires after 24 hours. For a lasting one:
   1. In Business Settings, go to *System users* and add an admin system user.
   2. Assign it the app and the WhatsApp account.
   3. Generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`.
   4. Put the token in `WHATSAPP_TOKEN`.
4. **Get the app secret.** Under *App settings → Basic*, copy the **App secret** into `WHATSAPP_APP_SECRET`.
5. **Pick a verify token.** Choose any long random string and put it in `WHATSAPP_VERIFY_TOKEN`, for example from `openssl rand -hex 24`.
6. **Expose the server over HTTPS.** Meta only calls public HTTPS URLs. In production, put the server behind your domain's TLS. For a trial, use a tunnel such as `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`.
7. **Register the webhook.**
   1. Under *WhatsApp → Configuration*, set the Callback URL to `https://<your-host>/whatsapp/webhook`.
   2. Set the Verify token to the same string as `WHATSAPP_VERIFY_TOKEN`, then press *Verify and save*. The server answers Meta's challenge itself.
   3. Under *Webhook fields*, **subscribe to `messages`**.
8. **Allow numbers.** Add numbers in international format without `+`, comma-separated: `WHATSAPP_ALLOWED_NUMBERS=923001234567,923331234567`.
9. **Restart the server** and send "salam" to the business number. You should get the report menu.

```env
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_VERIFY_TOKEN=<random string>
WHATSAPP_APP_SECRET=<app secret>
WHATSAPP_ALLOWED_NUMBERS=923001234567
# optional, see below
WHATSAPP_REPORT_TEMPLATE=daily_report
WHATSAPP_TEMPLATE_LANGUAGE=en
```

Sending scheduled reports needs only the token and phone number ID. Answering questions also needs the verify token and app secret. `GET /schedules` reports `whatsapp: true` once sending is possible, and the app's schedule editor says so under *Deliver to*.

## Scheduled reports and the 24-hour window

WhatsApp only allows free-form messages to a number within **24 hours of that person's last message** to you. Outside that window, a business may only send a pre-approved **message template**.

The scheduler handles this automatically:

1. It first sends the full report as normal text.
2. If Meta refuses that because the window is closed (error `131047`), it sends the template named in `WHATSAPP_REPORT_TEMPLATE` instead, filled with the report title and a short summary. The person can reply to open a new window and ask for detail.
3. If no template is configured, the delivery is recorded as failed in the report inbox. The report still reaches the app.

**Create the template** in WhatsApp Manager under *Message templates*:

- **Category:** Utility.
- **Language:** matching `WHATSAPP_TEMPLATE_LANGUAGE`.
- **Body:** two variables. For example:

  > Your report *{{1}}* is ready.
  >
  > {{2}}
  >
  > Reply to this message to ask about it.

Approval usually takes minutes to a few hours.

Practical tip: people who message the bot daily stay inside the window, so their reports arrive in full.

## Cost

Meta charges per delivered **template** message, by category and by the recipient's country. Replies to a user's own messages within the 24-hour service window are not charged. Prices change, so check Meta's current rate card at <https://developers.facebook.com/docs/whatsapp/pricing> before planning volumes. On top of Meta's charge, each question costs the same LLM tokens as asking in the app. Tapping a report from the menu uses stored SQL, so only the short summary uses the model.

## Troubleshooting

| Symptom | Cause |
|---|---|
| *Verify and save* fails | The server is unreachable over HTTPS, the verify token differs, or the four `WHATSAPP_*` credentials are not all set (the webhook returns 404 until they are) |
| Messages arrive in the log as 403 | `WHATSAPP_APP_SECRET` is wrong (it must be the app's secret, not the token) |
| The bot is silent | The number is not in `WHATSAPP_ALLOWED_NUMBERS`, or the `messages` webhook field is not subscribed |
| Error 190 in the log | The token expired: use a system-user token (step 3) |
| Scheduled report "failed: outside 24-hour window" | Set `WHATSAPP_REPORT_TEMPLATE` to an approved template |

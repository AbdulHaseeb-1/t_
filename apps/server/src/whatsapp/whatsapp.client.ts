/** WhatsApp Cloud API (Graph API) calls the bot needs. */

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly status?: number,
  ) {
    super(message);
  }

  /** Free-form messages are only allowed within 24 hours of the user's last message. */
  get outsideWindow(): boolean {
    return this.code === 131047 || /re-?engagement|24.?hour/i.test(this.message);
  }
}

export interface ListSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

export class WhatsAppClient {
  constructor(
    private readonly base: string,
    private readonly phoneNumberId: string,
    private readonly token: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private async post(body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.base.replace(/\/$/, '')}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_data?: { details?: string } } };
    if (!res.ok || json.error) {
      const e = json.error;
      throw new WhatsAppError(`WhatsApp: ${e?.message ?? `HTTP ${res.status}`}${e?.error_data?.details ? ` (${e.error_data.details})` : ''}`, e?.code, res.status);
    }
    return json;
  }

  sendText(to: string, body: string): Promise<unknown> {
    return this.post({ recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: body.slice(0, 4096) } });
  }

  /** Interactive list: up to 10 rows in total; row titles 24 chars, descriptions 72, button 20. */
  sendList(to: string, list: { header?: string; body: string; button: string; sections: ListSection[] }): Promise<unknown> {
    const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    return this.post({
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(list.header ? { header: { type: 'text', text: cut(list.header, 60) } } : {}),
        body: { text: cut(list.body, 1024) },
        action: {
          button: cut(list.button, 20),
          sections: list.sections.map((s) => ({
            title: cut(s.title, 24),
            rows: s.rows.map((r) => ({ id: r.id.slice(0, 200), title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })),
          })),
        },
      },
    });
  }

  sendTemplate(to: string, name: string, language: string, params: string[]): Promise<unknown> {
    return this.post({
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name,
        language: { code: language },
        components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text.slice(0, 1000) })) }] : [],
      },
    });
  }

  markRead(messageId: string): Promise<unknown> {
    return this.post({ status: 'read', message_id: messageId });
  }

  /** Downloads an incoming voice note or image: resolve the media URL, then fetch it with the token. */
  async download(mediaId: string, maxBytes: number): Promise<{ buffer: Buffer; mimetype: string }> {
    const meta = await fetch(`${this.base.replace(/\/$/, '')}/${mediaId}`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!meta.ok) throw new WhatsAppError(`WhatsApp media lookup: HTTP ${meta.status}`, undefined, meta.status);
    const info = (await meta.json()) as { url: string; mime_type: string; file_size?: number };
    if (info.file_size && info.file_size > maxBytes) throw new WhatsAppError(`That file is too large (${Math.round(info.file_size / 1e6)} MB)`);
    const file = await fetch(info.url, { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(this.timeoutMs * 2) });
    if (!file.ok) throw new WhatsAppError(`WhatsApp media download: HTTP ${file.status}`, undefined, file.status);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > maxBytes) throw new WhatsAppError(`That file is too large (${Math.round(buffer.length / 1e6)} MB)`);
    return { buffer, mimetype: info.mime_type.split(';')[0].trim() };
  }
}

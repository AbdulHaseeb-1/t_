import { Injectable, Logger } from '@nestjs/common';
import { JsonStore } from '../common/json-store.js';
import { AppConfig } from '../config/app-config.js';

export interface Device {
  token: string;
  platform: string;
  name?: string;
  registeredAt: string;
}

interface Ticket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Remote push through Expo's push service, for app builds that have push
 * credentials (FCM on Android). Without them the app still gets reports: it
 * polls the inbox and shows a local notification.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly store: JsonStore<{ devices: Device[] }>;

  constructor(private readonly config: AppConfig) {
    this.store = new JsonStore(config.get('DEVICES_FILE'), () => ({ devices: [] }));
  }

  async register(token: string, platform: string, name?: string): Promise<void> {
    await this.store.update((s) => {
      s.devices = s.devices.filter((d) => d.token !== token);
      s.devices.push({ token, platform, name, registeredAt: new Date().toISOString() });
    });
  }

  async unregister(token: string): Promise<void> {
    await this.store.update((s) => {
      s.devices = s.devices.filter((d) => d.token !== token);
    });
  }

  async count(): Promise<number> {
    return (await this.store.read()).devices.length;
  }

  /** Sends to every registered device; forgets devices Expo reports as unregistered. Returns how many accepted. */
  async send(title: string, body: string, data: Record<string, unknown>): Promise<number> {
    const devices = (await this.store.read()).devices;
    if (!devices.length) return 0;
    const token = this.config.get('EXPO_ACCESS_TOKEN');
    let ok = 0;
    const dead: string[] = [];
    for (let i = 0; i < devices.length; i += 100) {
      const chunk = devices.slice(i, i + 100);
      const res = await fetch(this.config.get('EXPO_PUSH_URL'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(chunk.map((d) => ({ to: d.token, title, body: body.slice(0, 180), data, sound: 'default', channelId: 'reports' }))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Expo push: HTTP ${res.status}`);
      const tickets = ((await res.json()) as { data: Ticket[] }).data ?? [];
      tickets.forEach((t, j) => {
        if (t.status === 'ok') ok++;
        else if (t.details?.error === 'DeviceNotRegistered') dead.push(chunk[j].token);
        else this.logger.warn(`Push to ${chunk[j].platform} failed: ${t.message}`);
      });
    }
    if (dead.length) await this.store.update((s) => void (s.devices = s.devices.filter((d) => !dead.includes(d.token))));
    return ok;
  }
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Plain app data (chats, server address). */
export const storage = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable: the app keeps working in memory.
    }
  },
};

/** Secrets go to the Keychain / Keystore; the web build has no secure store. */
export const secrets = {
  async get(key: string): Promise<string | null> {
    try {
      return Platform.OS === 'web' ? await AsyncStorage.getItem(key) : await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web') await AsyncStorage.setItem(key, value);
      else if (value) await SecureStore.setItemAsync(key, value);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      // ignore
    }
  },
};

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { MediaFile } from './api';

/** Long side after resizing: enough for the model to read small Urdu text (tested), small enough to upload fast. */
const MAX_SIDE = 1600;
const THUMB_SIDE = 240;

export type PickedImage = MediaFile & { thumb?: string };

/** Both dimensions, explicitly: expo-image-manipulator's web build turns a `null` side into a zero-height canvas. */
function fit(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: scale < 1 };
}

export async function prepareImage(asset: { uri: string; width: number; height: number }): Promise<PickedImage> {
  const target = fit(asset.width, asset.height, MAX_SIDE);
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (target.scaled) ctx.resize({ width: target.width, height: target.height });
  const image = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });

  const small = fit(target.width, target.height, THUMB_SIDE);
  const thumbCtx = ImageManipulator.manipulate(image.uri);
  thumbCtx.resize({ width: small.width, height: small.height });
  const thumb = await (await thumbCtx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });

  return {
    uri: image.uri,
    name: 'photo.jpg',
    type: 'image/jpeg',
    thumb: thumb.base64 ? `data:image/jpeg;base64,${thumb.base64}` : undefined,
  };
}

export async function pickImage(source: 'library' | 'camera'): Promise<PickedImage | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  return prepareImage(res.assets[0]);
}

/** Recordings are AAC in .m4a on iOS/Android and WebM/Opus in browsers. */
export function recordingFile(uri: string): MediaFile {
  if (Platform.OS === 'web') return { uri, name: 'voice.webm', type: 'audio/webm' };
  return { uri, name: 'voice.m4a', type: 'audio/m4a' };
}

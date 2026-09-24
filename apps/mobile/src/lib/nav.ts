import { router } from 'expo-router';

/** Back to the previous screen, or to the chat when Settings was opened directly (deep link, first run). */
export function leave(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

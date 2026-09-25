import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";

export const LEGAL_SUPPORT_EMAIL = "supportlemon@ratebolo.com";

export const LEGAL_URLS = {
  privacyPolicy: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || "",
  termsOfService: process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL || "",
  support: process.env.EXPO_PUBLIC_SUPPORT_URL || "",
} as const;

export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;
  try {
    await WebBrowser.openBrowserAsync(trimmed);
  } catch {
    await Linking.openURL(trimmed);
  }
}

export function openPrivacyPolicy(): Promise<void> {
  return openExternalUrl(LEGAL_URLS.privacyPolicy);
}

export function openTermsOfService(): Promise<void> {
  return openExternalUrl(LEGAL_URLS.termsOfService);
}

export function openSupportContact(): Promise<void> {
  return openExternalUrl(LEGAL_URLS.support);
}

export function openSupportEmail(): Promise<void> {
  return Linking.openURL(`mailto:${LEGAL_SUPPORT_EMAIL}`);
}

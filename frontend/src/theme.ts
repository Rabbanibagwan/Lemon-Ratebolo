import { Platform } from "react-native";

export const colors = {
  surface: "#FFFFFF",
  onSurface: "#111827",
  surfaceSecondary: "#F3F4F6",
  onSurfaceSecondary: "#1F2937",
  surfaceTertiary: "#E5E7EB",
  onSurfaceTertiary: "#374151",
  surfaceInverse: "#111827",
  onSurfaceInverse: "#FFFFFF",
  brand: "#166534",
  brandPrimary: "#15803D",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#DCFCE7",
  onBrandSecondary: "#166534",
  brandTertiary: "#22C55E",
  success: "#059669",
  warning: "#D97706",
  error: "#DC2626",
  onError: "#FFFFFF",
  border: "#D1D5DB",
  borderStrong: "#111827",
  divider: "#E5E7EB",
  muted: "#6B7280",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = { sm: 0, md: 0, lg: 0, pill: 999 };

// System fonts (Space Grotesk / JetBrains Mono are unavailable via google-fonts here).
export const font = {
  display: Platform.select({ ios: "System", android: "sans-serif", default: "System" }) as string,
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as string,
};

export const type = {
  h1: { fontSize: 28, fontWeight: "800" as const, color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.5 },
  h2: { fontSize: 22, fontWeight: "800" as const, color: colors.onSurface, fontFamily: font.display, letterSpacing: -0.3 },
  h3: { fontSize: 18, fontWeight: "700" as const, color: colors.onSurface, fontFamily: font.display },
  body: { fontSize: 15, color: colors.onSurface, fontFamily: font.display },
  label: { fontSize: 12, fontWeight: "700" as const, color: colors.onSurfaceTertiary, textTransform: "uppercase" as const, letterSpacing: 1, fontFamily: font.display },
  mono: { fontSize: 15, color: colors.onSurface, fontFamily: font.mono },
  monoLg: { fontSize: 22, fontWeight: "700" as const, color: colors.onSurface, fontFamily: font.mono },
  monoXl: { fontSize: 32, fontWeight: "800" as const, color: colors.onSurface, fontFamily: font.mono },
  muted: { fontSize: 13, color: colors.muted, fontFamily: font.display },
};

export const money = (n: number | null | undefined) => {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
};

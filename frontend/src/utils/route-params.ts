/** Expo Router search params can be `string | string[]`. Always take a single value. */
export function routeParam(v: string | string[] | undefined, fallback = ""): string {
  if (Array.isArray(v)) return String(v[0] ?? fallback);
  if (v == null || v === "") return fallback;
  return String(v);
}

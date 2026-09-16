export const ENV_ALLOWLIST_KEYS = [
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'windir',
  'APPDATA',
  'LOCALAPPDATA',
] as const;

export function buildChildEnv(
  callerEnv: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      base[key] = value;
    }
  }
  return { ...base, ...callerEnv };
}

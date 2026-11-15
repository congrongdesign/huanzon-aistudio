import fs from 'node:fs';
import path from 'node:path';

// Only connection/settings keys; never copy projects, cached images or auth sessions.
export function isPersistentSetting(key: string): boolean {
  return /^(hz_(grs_|ds_|chat_|codia_|provider_|active_provider_|capability_bindings|operation_routes|image_models_cache|image_favorite_models|model_category_overrides)|hz_theme$|theme$)/.test(key);
}

export function readSettings(directory: string): Record<string, string> {
  const file = path.join(directory, 'desktop-settings.json');
  if (!fs.existsSync(file)) return {};
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid desktop settings');
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => isPersistentSetting(key) && typeof item === 'string'));
}

export function updateSettings(directory: string, changes: unknown): void {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return;
  const current = readSettings(directory);
  for (const [key, value] of Object.entries(changes)) {
    if (!isPersistentSetting(key)) continue;
    if (value === null) delete current[key];
    else if (typeof value === 'string') current[key] = value;
  }
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'desktop-settings.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(current), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, updateSettings } from '../electron/settings-store';
import { readProviderProfilesStore, writeProviderProfilesStore } from '../src/lib/provider-profiles-store';
import { listProjects, createProject, getProjectById, getLocalDataDirectory } from '../src/lib/local-backend';
import { readRuntimeConfig, writeRuntimeConfig } from '../src/lib/runtime-config';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-upgrade-中文 用户-'));
process.env.LOCAL_DATA_DIR = directory;
try {
  const project = createProject('upgrade-qa', '升级前的画板');
  const file = path.join(getLocalDataDirectory(), 'db.json');
  const before = fs.readFileSync(file);
  writeRuntimeConfig({ backendMode: 'local', mediaDirectory: path.join(directory, '中文 图片库') });
  const providers = writeProviderProfilesStore({ profiles: [{ id: 'qa', name: '原中转站', baseUrl: 'https://example.invalid/v1', apiKeyLocal: 'fixture-key-do-not-print', type: 'custom', enabled: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }], activeProviderId: 'qa' });
  updateSettings(directory, { hz_grs_api_key: 'fixture-key-do-not-print', hz_grs_base_url: providers.profiles[0].baseUrl, auth_token: 'must-not-persist', hz_provider_profiles_v1: JSON.stringify(providers.profiles) });
  assert.equal(readSettings(directory).hz_grs_api_key, providers.profiles[0].apiKeyLocal);
  assert.equal(readSettings(directory).auth_token, undefined);
  assert.deepEqual(readProviderProfilesStore().profiles, providers.profiles);
  assert.equal(readRuntimeConfig().mediaDirectory, path.join(directory, '中文 图片库'));
  assert.equal(listProjects('upgrade-qa').length, 1);
  assert.equal(getProjectById(project.id, 'upgrade-qa')?.name, project.name);
  assert.deepEqual(fs.readFileSync(file), before, 'reading during an upgrade must not rewrite the database');
  updateSettings(directory, { hz_grs_api_key: null });
  assert.equal(readSettings(directory).hz_grs_api_key, undefined);
  assert.equal(readSettings(directory).hz_grs_base_url, providers.profiles[0].baseUrl);
  const settingsFile = path.join(directory, 'desktop-settings.json');
  fs.writeFileSync(settingsFile, '{invalid');
  assert.throws(() => updateSettings(directory, { hz_grs_api_key: 'replacement' }));
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{invalid', 'corrupt settings must not be silently overwritten');
  console.log('PASS: upgrade preserves projects, provider credentials, storage paths; settings persist and explicit removal works; corrupt settings protected.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

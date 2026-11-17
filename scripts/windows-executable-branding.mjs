import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as ResEdit from 'resedit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

export function inspectWindowsBranding(executable, iconFile) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(exe);
  const expected = ResEdit.Data.IconFile.from(fs.readFileSync(iconFile)).icons.map(icon => digest(icon.data.bin || icon.data.generate()));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  const iconsMatch = groups.length > 0 && groups.every(group => {
    const actual = group.getIconItemsFromEntries(resources.entries).map(icon => digest(icon.bin || icon.generate()));
    return actual.length === expected.length && actual.every((hash, index) => hash === expected[index]);
  });
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries).flatMap(info => info.getAllLanguagesForStringValues().map(language => info.getStringValues(language)));
  return { iconsMatch, groups: groups.map(group => ({ id: group.id, lang: group.lang, sizes: group.icons.map(icon => icon.width || 256) })), versions };
}

/** Edit only the unsigned app executable, before installer generation and any code signing. */
export function brandWindowsExecutable(executable, iconFile, { name, version, company = 'HuanZon' }) {
  // Refuse signed input: changing its resources would invalidate its signature.
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(executable));
  const resources = ResEdit.NtExecutableResource.from(exe);
  const icons = ResEdit.Data.IconFile.from(fs.readFileSync(iconFile)).icons.map(icon => icon.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }]) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  }
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  for (const info of versions.length ? versions : [ResEdit.Resource.VersionInfo.createEmpty()]) {
    info.setFileVersion(version, 1033);
    info.setProductVersion(version, 1033);
    const languages = info.getAllLanguagesForStringValues();
    for (const language of languages.length ? languages : [{ lang: 1033, codepage: 1200 }]) {
      info.setStringValues(language, {
        CompanyName: company, FileDescription: name, ProductName: name,
        InternalName: path.basename(executable), OriginalFilename: path.basename(executable),
        FileVersion: version, ProductVersion: version,
        LegalCopyright: `Copyright © 2026 ${company}`,
      });
    }
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(exe);
  fs.writeFileSync(executable, Buffer.from(exe.generate()));
  const result = inspectWindowsBranding(executable, iconFile);
  if (!result.iconsMatch || !result.versions.length || result.versions.some(info => info.ProductName !== name || info.FileVersion !== version)) {
    throw new Error('Windows executable branding verification failed');
  }
  return result;
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const name = context.packager.appInfo.productFilename;
  brandWindowsExecutable(path.join(context.appOutDir, `${name}.exe`), path.join(root, 'electron/icon.ico'), {
    name: context.packager.appInfo.productName,
    version: context.packager.appInfo.version,
  });
  console.log('Verified Windows EXE icons and product identity.');
}

"""Register the .hzlib logo in an existing macOS bundle without copying the app."""
import plistlib
import sys
from pathlib import Path

bundle = Path(sys.argv[1])
plist = bundle / 'Contents/Info.plist'
with plist.open('rb') as source:
    info = plistlib.load(source)

identifier = 'com.huanzon.aistudio.library'
document = {
    'CFBundleTypeName': '环中AIStudio资源包',
    'CFBundleTypeExtensions': ['hzlib'],
    'CFBundleTypeIconFile': 'icon.icns',
    'CFBundleTypeRole': 'Viewer',
    'LSHandlerRank': 'Owner',
    'LSItemContentTypes': [identifier],
}
declaration = {
    'UTTypeIdentifier': identifier,
    'UTTypeDescription': '环中AIStudio资源包',
    'UTTypeConformsTo': ['public.data', 'public.content'],
    'UTTypeIconFile': 'icon.icns',
    'UTTypeTagSpecification': {
        'public.filename-extension': ['hzlib'],
        'public.mime-type': 'application/vnd.huanzon.library+zip',
    },
}
info['CFBundleDocumentTypes'] = [entry for entry in info.get('CFBundleDocumentTypes', [])
    if identifier not in entry.get('LSItemContentTypes', []) and 'hzlib' not in entry.get('CFBundleTypeExtensions', [])] + [document]
info['UTExportedTypeDeclarations'] = [entry for entry in info.get('UTExportedTypeDeclarations', [])
    if entry.get('UTTypeIdentifier') != identifier] + [declaration]
if not (bundle / 'Contents/Resources/icon.icns').is_file():
    raise SystemExit('Application logo is missing')
with plist.open('wb') as destination:
    plistlib.dump(info, destination, sort_keys=False)
print(f'Registered .hzlib logo: {bundle}')

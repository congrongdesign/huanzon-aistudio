"""Complete runtime files omitted by Next's standalone tracing for bundled SDKs."""
from pathlib import Path
import json
import os
import shutil

root = Path(__file__).resolve().parents[1]
build_dir = root / os.environ.get('HZ_NEXT_DIST_DIR', '.next')
standalone = build_dir / 'standalone'
modules = root / 'node_modules'
seen = set()

def copy_package(source):
    source = source.resolve()
    if source in seen:
        return
    seen.add(source)
    target = standalone / source.relative_to(root)
    shutil.copytree(source, target, dirs_exist_ok=True, symlinks=True)
    data = json.loads((source / 'package.json').read_text())
    dependencies = set(data.get('dependencies', {})) | set(data.get('optionalDependencies', {}))
    for name in dependencies:
        for parent in [source, *source.parents]:
            candidate = parent / 'node_modules' / name
            if (candidate / 'package.json').exists():
                resolved = candidate.resolve()
                if not resolved.is_relative_to(modules):
                    break
                copy_package(resolved)
                link = standalone / candidate.relative_to(root)
                if not link.exists() and not link.is_symlink():
                    link.parent.mkdir(parents=True, exist_ok=True)
                    if candidate.is_symlink():
                        link.symlink_to(candidate.readlink())
                    else:
                        shutil.copytree(candidate, link, symlinks=True)
                break

for name in ['coze-coding-dev-sdk', 'jszip', '@supabase/supabase-js', 'dotenv', '@libsql/client', '@libsql/win32-x64-msvc']:
    source = modules / name
    copy_package(source)
    link = standalone / 'node_modules' / name
    if not link.exists() and not link.is_symlink():
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(source.readlink())
# Tracing can preserve a pnpm hoisted link while omitting its target package.
hoisted = standalone / 'node_modules' / '.pnpm' / 'node_modules'
if hoisted.exists():
    for link in list(hoisted.iterdir()):
        source = modules / '.pnpm' / 'node_modules' / link.name
        if link.is_symlink() and not link.exists() and (source / 'package.json').exists():
            copy_package(source)
shutil.copytree(modules / 'next' / 'dist', standalone / 'node_modules' / 'next' / 'dist', dirs_exist_ok=True)
shutil.copytree(build_dir / 'static', standalone / build_dir.name / 'static', dirs_exist_ok=True)
shutil.copytree(root / 'public', standalone / 'public', dirs_exist_ok=True)
shutil.copyfile(root / 'THIRD_PARTY_NOTICES.md', standalone / 'THIRD_PARTY_NOTICES.md')
print(f'Completed SDK runtime ({len(seen)} packages), Next runtime, static assets and public files.')

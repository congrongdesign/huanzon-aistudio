"""Login/periodic mount recovery for this Mac, using app config + macOS Keychain.

No user/project data is changed. The application validates repository identity
before reading or writing a backup. This helper never creates a mount folder.
"""
import json
from pathlib import Path
import subprocess
from urllib.parse import urlparse

config_file = Path.home() / 'Library/Application Support/环中AIStudio/project-archive-config.json'
helper = Path('/Applications/环中AIStudio.app/Contents/Resources/standalone/workers/nas-mount-macos')
try:
    config = json.loads(config_file.read_text())
    remote = config.get('remote', {})
    url = remote.get('url', '')
    parsed = urlparse(url)
    if parsed.scheme == 'smb' and parsed.hostname and not parsed.password and helper.is_file():
        mounted = subprocess.check_output(['/sbin/mount']).decode()
        mount_path = remote.get('mountPath', config.get('syncDir', ''))
        if not any((' on ' + mount_path + ' (smbfs') in line for line in mounted.splitlines()):
            subprocess.run([str(helper), url], timeout=20, capture_output=True, check=False)
except (OSError, ValueError, subprocess.SubprocessError):
    pass  # App exposes the actionable connection status; background login stays quiet.

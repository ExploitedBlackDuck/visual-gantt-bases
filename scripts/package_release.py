#!/usr/bin/env python3
"""Package Visual Gantt by LanternSquid using only reviewed project files."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
version = manifest['version']
dist = root / 'dist'
dist.mkdir(exist_ok=True)
excluded = {'.git', 'node_modules', 'dist', '.cache', '__pycache__'}
files = sorted(p for p in root.rglob('*') if p.is_file() and not (set(p.relative_to(root).parts) & excluded) and p.name not in {'.DS_Store', 'SHA256SUMS.txt'})
checksums = '\n'.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.relative_to(root).as_posix() for p in files) + '\n'
(root / 'SHA256SUMS.txt').write_text(checksums)
archive = dist / f'Visual-Gantt-by-LanternSquid-v{version}.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
    for path in [*files, root / 'SHA256SUMS.txt']:
        output.write(path, Path(f'visual-gantt-bases-v{version}') / path.relative_to(root))
with zipfile.ZipFile(archive) as output:
    assert output.testzip() is None
    for line in checksums.splitlines():
        expected, name = line.split('  ', 1)
        assert hashlib.sha256(output.read(f'visual-gantt-bases-v{version}/{name}')).hexdigest() == expected
for name in ['main.js', 'manifest.json', 'styles.css']:
    (dist / name).write_bytes((root / name).read_bytes())
(dist / (archive.name + '.sha256')).write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
print(archive)
print('Archive and every included checksum verified.')

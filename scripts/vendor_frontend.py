"""Download pinned frontend packages, preserving their upstream licenses."""
import hashlib
import io
import json
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1] / 'app/static/vendor'
PACKAGES = [
    ('bootstrap', '5.3.0', ('dist/css/bootstrap.min.css', 'dist/js/bootstrap.bundle.min.js')),
    ('bootstrap-icons', '1.10.5', ('font/bootstrap-icons.css', 'font/fonts/')),
    ('leaflet', '1.9.3', ('dist/leaflet.js', 'dist/leaflet.css', 'dist/images/')),
    ('@fortawesome/fontawesome-free', '6.4.0', ('css/all.min.css', 'webfonts/')),
    ('html2canvas', '1.4.1', 'dist/html2canvas.min.js'),
    ('leaflet.heat', '0.2.0', 'dist/leaflet-heat.js'),
    ('jszip', '3.10.1', 'dist/jszip.min.js'),
    ('file-saver', '2.0.5', 'dist/FileSaver.min.js'),
]


def download(spec):
    package, version, prefixes = spec
    name = package.split('/')[-1]
    url = f'https://registry.npmjs.org/{package}/-/{name}-{version}.tgz'
    with urlopen(url, timeout=60) as response:
        data = response.read()
    folder = ROOT / f'{name}-{version}'
    prefixes = (prefixes,) if isinstance(prefixes, str) else prefixes
    count = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive.getmembers():
            if not member.isfile() or not member.name.startswith('package/'):
                continue
            relative = member.name.removeprefix('package/')
            if not (relative.startswith(prefixes) or Path(relative).name.lower().startswith(('license', 'licence', 'copying'))):
                continue
            if relative.endswith('.map'):
                continue
            target = (folder / relative).resolve()
            if not target.is_relative_to(folder.resolve()):
                raise ValueError('Unsafe archive member')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())
            count += 1
    print(f'{name} {version}: {count} files')
    return dict(package=package, version=version, source=url, sha256=hashlib.sha256(data).hexdigest())


if __name__ == '__main__':
    ROOT.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        manifest = list(pool.map(download, PACKAGES))
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

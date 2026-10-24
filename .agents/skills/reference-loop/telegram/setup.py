"""Install the two public connectors on the current host; account access is opt-in."""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tomllib
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = Path.home() / '.local/share/reference-loop-telegram'
UPSTREAM = ROOT / 'upstream'
COMMIT = 'e55d9c7a66a8eb0855debb268a4ed5b63749af2d'
FEED_VERSION = '2.7.0'
WIN = os.name == 'nt'


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def resolve(name):
    found = shutil.which(name + '.cmd') if WIN else None
    found = found or shutil.which(name)
    local = Path.home() / '.local/bin' / (name + '.exe' if WIN else name)
    if not found and local.exists():
        found = str(local)
    if not found:
        raise RuntimeError(f'{name} is required on this device but was not found.')
    return found


def current_entry(client, name):
    if client == 'codex':
        path = Path(os.environ.get('CODEX_HOME', Path.home() / '.codex')) / 'config.toml'
        return tomllib.loads(path.read_text(encoding='utf-8')).get('mcp_servers', {}).get(name) if path.exists() else None
    path = Path.home() / '.claude.json'
    return json.loads(path.read_text(encoding='utf-8')).get('mcpServers', {}).get(name) if path.exists() else None


def register(cli, client, name, command, args):
    old = current_entry(client, name)
    if old:
        if old.get('command') != str(command) or old.get('args', []) != args or old.get('enabled') is False:
            raise RuntimeError(f'Existing {name} differs; preserved for review.')
        print(name + ': already registered with the expected command')
        return
    flags = ['--transport', 'stdio', '--scope', 'user'] if client == 'claude' else []
    run(cli, 'mcp', 'add', *flags, name, '--', command, *args)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--client', required=True, choices=['codex', 'claude'])
    parser.add_argument('--account', action='store_true')
    args = parser.parse_args()
    cli, git, uv = resolve(args.client), resolve('git'), resolve('uv')
    if not UPSTREAM.exists():
        ROOT.mkdir(parents=True, exist_ok=True)
        run(git, 'clone', '--no-checkout', 'https://github.com/chigwell/telegram-mcp.git', UPSTREAM)
        run(git, '-C', UPSTREAM, 'checkout', '--detach', COMMIT)
    else:
        head = subprocess.check_output([git, '-C', str(UPSTREAM), 'rev-parse', 'HEAD'], text=True).strip()
        if head != COMMIT:
            raise RuntimeError('Existing upstream revision differs; preserved for review.')
    run(uv, 'sync', '--project', UPSTREAM, '--frozen', '--no-dev', '--python', '3.13')
    python = UPSTREAM / '.venv' / ('Scripts/python.exe' if WIN else 'bin/python')
    feed_dir = Path.home() / '.local/share/reference-loop-feeds' / ('v' + FEED_VERSION)
    feed = feed_dir / ('feed-mcp.exe' if WIN else 'feed-mcp')
    if not feed.exists():
        systems = {'Windows': 'Windows', 'Darwin': 'Darwin', 'Linux': 'Linux'}
        arches = {'AMD64': 'x86_64', 'x86_64': 'x86_64', 'arm64': 'arm64', 'aarch64': 'arm64'}
        system, arch = systems[platform.system()], arches[platform.machine()]
        filename = f'feed-mcp_{system}_{arch}.' + ('zip' if WIN else 'tar.gz')
        feed_dir.mkdir(parents=True, exist_ok=True)
        archive = feed_dir.parent / filename
        urllib.request.urlretrieve(f'https://github.com/richardwooding/feed-mcp/releases/download/v{FEED_VERSION}/{filename}', archive)
        if WIN:
            with zipfile.ZipFile(archive) as package:
                package.extract('feed-mcp.exe', feed_dir)
                for license_file in ['LICENSE', 'README.md']:
                    if license_file in package.namelist():
                        package.extract(license_file, feed_dir)
        else:
            with tarfile.open(archive) as package:
                package.extractall(feed_dir, filter='data')
            feed.chmod(0o755)
    register(cli, args.client, 'reference-telegram-public', python, [str(HERE / 'public_server.py')])
    register(cli, args.client, 'reference-feeds', python, [str(HERE / 'feed_server.py')])
    if args.account:
        if not (ROOT / 'private' / (args.client + '.json')).exists():
            raise RuntimeError('Local account login required first; public connectors are installed.')
        register(cli, args.client, 'reference-telegram-account', python, [str(HERE / 'account.py'), 'serve', '--client', args.client])
    print('Public connectors prepared. Open a new client session and test actual tool calls on this device.')


if __name__ == '__main__':
    main()

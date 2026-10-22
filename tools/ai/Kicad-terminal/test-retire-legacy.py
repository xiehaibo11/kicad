#!/usr/bin/env python3
"""The installer retires exact middleware files and preserves user data."""
import importlib.util
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location('retire', Path(__file__).with_name('retire-legacy.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
    prefix = Path(directory)
    old = prefix / 'share/kicad-terminal/easyeda-mcp.mjs'
    old.parent.mkdir(parents=True)
    old.write_text('retired relay')
    wrapper = prefix / 'bin/kicad-agent'
    wrapper.parent.mkdir()
    wrapper.write_text('old Go entry')
    credentials = prefix / 'share/kicad-terminal/provider.json'
    credentials.write_text('must survive')
    report = module.retire(prefix)
    assert len(report['retired']) == 2 and not old.exists() and not wrapper.exists()
    assert all(Path(item['backup']).is_file() for item in report['retired'])
    assert credentials.read_text() == 'must survive'
    assert module.retire(prefix) == {'retired': []}
print('Legacy middleware retirement passed: recoverable, precise, idempotent.')

// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withoutLegacyKiCadServers} from '../legacy.mjs';
test('retired EDA relay commands cannot return through renamed merged configuration',()=>{
  const other={command:['node','/workspace/other-service.mjs']};
  assert.deepEqual(withoutLegacyKiCadServers({kicad:{},easyeda:{},renamed:{command:['/usr/bin/node','/path/easyeda-mcp.mjs']},old:{command:'/path/kicad-agent',args:['mcp']},stdio:{command:['node','/path/kicad-direct.mjs','mcp']},other}),{other});
});

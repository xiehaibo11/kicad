// SPDX-License-Identifier: GPL-3.0-or-later
import { workspaceNames,workspaceNative } from './workspace-native.mjs';
import { libraryNames,libraryNative } from './library-native.mjs';
import { schematicNames,schematicNative } from './schematic-native.mjs';
import { ruleNames,rulesNative } from './rules-native.mjs';
import { boardRouteNames,boardRouteNative } from './board-routing-native.mjs';
import { boardNames,boardNative } from './board-native.mjs';
export const nativeWorkflows=new Map([
  ...workspaceNames.map(name=>[name,workspaceNative]),...libraryNames.map(name=>[name,libraryNative]),
  ...schematicNames.map(name=>[name,schematicNative]),...ruleNames.map(name=>[name,rulesNative]),
  ...boardRouteNames.map(name=>[name,boardRouteNative]),...boardNames.map(name=>[name,boardNative]),
]);
export const nativeWorkflow=(action,p,dispatch,options)=>nativeWorkflows.get(action)(action,p,dispatch,options);

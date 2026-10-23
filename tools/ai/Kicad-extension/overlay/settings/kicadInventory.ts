import {ref} from 'vue';
import {transport} from '../../core/runtimeTransport';
import type {SettingsInventory} from '../../../../shared/kicadInventory';

// One file-based inventory shared by the Skills, Commands, Hooks, Plugins, MCP and
// Permissions pages. Loading never connects servers or starts the CLI.
const inventory=ref<SettingsInventory>();
const loading=ref(false),error=ref('');
let pending:Promise<void>|undefined;
export function useKicadInventory(){
  const refresh=()=>pending??=(async()=>{
    loading.value=true;error.value='';
    try{inventory.value=(await (transport as any).kicadInventory()).inventory;}
    catch(cause){error.value=cause instanceof Error?cause.message:String(cause);}
    finally{loading.value=false;pending=undefined;}
  })();
  if(!inventory.value&&!pending)void refresh();
  const setEnabled=async(kind:'skill'|'server',name:string,enabled:boolean)=>{await (transport as any).kicadSetEnabled(kind,name,enabled);await refresh();};
  const open=(file?:string)=>file?(transport as any).openFile(file):undefined;
  return {inventory,loading,error,refresh,setEnabled,open};
}
export const scopeLabel=(scope:string)=>({user:'User',project:'Project',local:'Local',plugin:'Plugin',builtin:'Built-in'} as Record<string,string>)[scope]||scope;
export const flagLabel=(kind:string)=>({duplicate:'duplicate',conflict:'overridden',stale:'outdated',disabled:'off',manual:'manual',oneoff:'one-off',ignored:'ignored',unusable:'unusable'} as Record<string,string>)[kind]||kind;
export const shortPath=(file='',home='',cwd='')=>cwd&&file.startsWith(cwd+'/')?file.slice(cwd.length+1):home&&file.startsWith(home+'/')?'~'+file.slice(home.length):file;

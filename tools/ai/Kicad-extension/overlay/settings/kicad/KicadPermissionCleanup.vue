<template>
  <SettingsSection v-if="issues.length" title="Rule Cleanup">
    <SettingsSubSection caption="Outdated rules allow programs or tools that no longer exist. One-off rules were approved for a single exact command. Removing a rule only means the next matching request asks again.">
      <SettingsCell v-for="(issue, index) in issues" :key="issue.scope + issue.list + issue.rule" :divider="index > 0">
        <template #label>
          <div class="kicad-rule-label">
            <KicadFlag :kind="issue.kind" :message="issue.message" />
            <Badge size="small" variant="subtle">{{ scopeLabel(issue.scope) }} · {{ issue.list }}</Badge>
          </div>
        </template>
        <template #description>
          <code class="kicad-rule-text">{{ issue.rule }}</code>
          <span class="kicad-rule-reason">{{ issue.message }}</span>
        </template>
      </SettingsCell>
      <div class="kicad-rule-actions">
        <Button v-if="stale.length" variant="secondary" size="small" :disabled="busy" @click="remove(stale)">Remove {{ stale.length }} outdated</Button>
        <Button v-if="oneoff.length" variant="tertiary" size="small" :disabled="busy" @click="remove(oneoff)">Remove {{ oneoff.length }} one-off</Button>
        <span v-if="blocked" class="kicad-rule-note">User rules are edited in settings.json; switch to the default profile to remove them here.</span>
        <span v-if="failure" class="kicad-rule-error" role="alert">{{ failure }}</span>
      </div>
    </SettingsSubSection>
  </SettingsSection>
</template>
<script setup lang="ts">
import KicadFlag from './KicadFlag.vue';
import {computed,ref} from 'vue';
import SettingsSection from '../SettingsSection.vue';
import SettingsSubSection from '../SettingsSubSection.vue';
import SettingsCell from '../SettingsCell.vue';
import Badge from '../../Common/Badge.vue';
import Button from '../../Common/Button.vue';
import {useSettingsStore} from '../../../composables/useSettingsStore';
import {transport} from '../../../core/runtimeTransport';
import {scopeLabel,useKicadInventory} from '../kicadInventory';
type Issue={scope:'user'|'project'|'local';list:'allow'|'deny'|'ask';rule:string;kind:string;message:string};
const {inventory}=useKicadInventory();
const {activeProfile,reloadSettings}=useSettingsStore() as ReturnType<typeof useSettingsStore>&{reloadSettings:()=>Promise<void>};
const busy=ref(false),failure=ref('');
const issues=computed<Issue[]>(()=>inventory.value?.permissions||[]);
const stale=computed(()=>issues.value.filter(issue=>issue.kind==='stale'));
const oneoff=computed(()=>issues.value.filter(issue=>issue.kind==='oneoff'));
// With a profile active the host leaves settings.json alone (its "global" target is the profile file).
const blocked=computed(()=>!!activeProfile.value&&issues.value.some(issue=>issue.scope==='user'));
async function remove(selected:Issue[]){
  busy.value=true;failure.value='';
  try{
    // The host writes, reads each file back and returns the refreshed inventory.
    const result=await (transport as any).kicadCleanPermissions(selected.map(({scope,list,rule})=>({scope,list,rule})));
    inventory.value=result.inventory;
    await reloadSettings();
    const skipped=(result.skipped||[]).filter((item:any)=>item.reason!=='A settings profile is active.');
    if(skipped.length)failure.value=skipped.length+' rule(s) could not be removed: '+skipped[0].reason;
  }catch(error){failure.value='Could not update the rules: '+(error instanceof Error?error.message:String(error));}
  finally{busy.value=false;}
}
</script>
<style scoped>
.kicad-rule-label{display:flex;align-items:center;gap:6px;}
.kicad-rule-text{display:block;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;word-break:break-all;white-space:pre-wrap;max-height:4.5em;overflow:hidden;}
.kicad-rule-reason{display:block;margin-top:2px;}
.kicad-rule-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 0;}
.kicad-rule-note{font-size:12px;color:var(--cursor-text-tertiary);}
.kicad-rule-error{font-size:12px;color:var(--vscode-errorForeground,#f48771);}
</style>

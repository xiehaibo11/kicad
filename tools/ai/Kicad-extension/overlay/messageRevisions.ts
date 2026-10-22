export interface MessageRevision { originalId:string; replacementId:string }

// A revision replaces the visible branch beginning at the edited request. Keep
// the SDK transcript intact: editing a prompt never rewinds files or tool work.
export function applyMessageRevisions<T extends {uuid?:string;type?:string;parent_tool_use_id?:string|null}>(messages:T[],revisions:MessageRevision[]):T[] {
  let result=messages;
  for(const revision of revisions){
    const original=result.findIndex(m=>m.uuid===revision.originalId && m.type==='user' && !m.parent_tool_use_id);
    const replacement=result.findIndex(m=>m.uuid===revision.replacementId && m.type==='user' && !m.parent_tool_use_id);
    // A saved intent without an accepted SDK input must never hide history.
    if(original>=0 && replacement>original)result=[...result.slice(0,original),...result.slice(replacement)];
  }
  return result;
}

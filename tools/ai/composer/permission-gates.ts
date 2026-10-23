// Harness permission gates, shared by both frontends. Gate 1 is a deny list that
// holds in every permission mode (catastrophic, irreversible system operations).
// Gate 2 matches rules that need the user's confirmation instead of automatic
// approval (outside-workspace changes, secrets, history rewrites, piping remote
// scripts into a shell). Gate 3 is the host's normal permission flow, which keeps
// deciding everything else. The separate autoDecision allowlist may approve known low-risk calls.
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export type Gate={decision:'deny'|'ask';reason:string};
/** Conservative local auto mode. Unknown operations still use the host approval UI. */
export function autoDecision(tool:string,input:any,cwd:string):{decision:'allow'|'ask'|'deny';reason:string}{
  const gate=toolGate(tool,input,cwd);if(gate)return gate;
  if(['Read','read','Grep','grep','Glob','glob','LS','ls','TodoWrite','todowrite','mcp__kicad__capability_search'].includes(tool)){
    const target=input?.file_path||input?.filePath||input?.path||'';
    if(target&&SENSITIVE_PATH.test(String(target)))return {decision:'ask',reason:'Potential credentials need confirmation.'};
    return {decision:'allow',reason:'Local read or task tracking.'};
  }
  if(WRITE_TOOLS.has(tool)){
    const target=input?.file_path||input?.filePath||input?.path;
    if(typeof target==='string'){
      let actual=path.resolve(cwd,target),root=path.resolve(cwd);
      // Resolve existing ancestors to avoid writing through a workspace symlink.
      const resolve=(p:string):string=>{try{return fs.realpathSync(p);}catch{const parent=path.dirname(p);return parent===p?p:path.join(resolve(parent),path.basename(p));}};
      actual=resolve(actual);root=resolve(root);
      if(inside(actual,root))return {decision:'allow',reason:'Edit within the workspace.'};
    }
    return {decision:'ask',reason:'Confirm writes outside the workspace or with unknown paths.'};
  }
  if(SHELL_TOOLS.has(tool)){
    const command=input?.command;
    if(typeof command==='string'&&!/[\n\r$`<>;|&{}()\\]/.test(command)){
      const argv=words(command).map(v=>v.replace(/^['"]|['"]$/g,'')),program=argv[0];
      // No wrappers, substitutions, executable filters, pagers or output files.
      const safe=['ls','pwd','cat','head','tail','wc','grep'].includes(program)||
        program==='rg'&&!argv.some(v=>/^--(?:pre|hostname-bin|pre-glob)(?:=|$)/.test(v));
      // Git external diff/textconv/pagers may be configured even with harmless flags.
      if(safe)return {decision:'allow',reason:'Simple local read command.'};
    }
  }
  return {decision:'ask',reason:'This operation needs confirmation in local auto mode.'};
}
const SHELL_TOOLS=new Set(['Bash','bash','shell']);
const WRITE_TOOLS=new Set(['Write','Edit','MultiEdit','NotebookEdit','write','edit','patch']);
const READ_TOOLS=new Set(['Read','read']);

// Matched against the whole command text (not words), so they hold inside pipelines.
const DENY_TEXT:[RegExp,string][]=[
  [/>\s*\/dev\/(?:r?disk\d|sd[a-z]|nvme\d)/,'Writing raw data to a device is never done by the agent.'],
  [/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,'A fork bomb is never run.'],
];
// Matched against the program a segment runs, so quoted mentions (echo "sudo") never trigger.
function denyCommand(argv:string[]):string|undefined{
  const [name='',...rest]=argv,program=path.basename(name);
  if(program==='sudo'||program==='doas')return 'sudo runs commands as another user; run it yourself outside the agent if it is really needed.';
  if(['shutdown','reboot','halt','poweroff'].includes(program))return 'Shutting down or rebooting the machine is never done by the agent.';
  if(/^mkfs(?:\.\w+)?$/.test(program)||/^newfs/.test(program))return 'Formatting a file system is never done by the agent.';
  if(program==='dd'&&rest.some(word=>/^of=\/dev\//.test(word)))return 'Writing raw data to a device is never done by the agent.';
  if(program==='diskutil'&&/^(?:erase\w*|zeroDisk|secureErase|partitionDisk|reformat)$/i.test(rest[0]||''))return 'Erasing or partitioning a disk is never done by the agent.';
  if((program==='chmod'||program==='chown')&&rest.some(word=>/^-\w*R/.test(word))&&rest.at(-1)==='/')return 'Recursively changing ownership or permissions of / is never done by the agent.';
}
const PREFIXES=new Set(['then','do','else','exec','nohup','xargs','env','time','command','builtin','(','{','!']);
const ASK:[RegExp,string][]=[
  [/\bgit\s+push\b[^;&|]*(?:\s--force(?:-with-lease)?\b|\s-f\b)/,'A force push rewrites shared history.'],
  [/\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-\w*f/,'This discards uncommitted work.'],
  [/\b(?:curl|wget)\b[^;&]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/,'This runs a downloaded script without review.'],
  [/(?:~|\$HOME|\$\{HOME\}|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/\.(?:ssh|aws|gnupg|kube|netrc|docker\/config\.json)\b|\bid_(?:rsa|ed25519|ecdsa)\b|\bsecurity\s+(?:find|dump)-(?:generic|internet)-password\b|\bdump-keychain\b/,'This reads credentials or keys.'],
  [/(?:^|[\s/'"=])\.env(?!\.(?:example|sample|template)\b)(?:\.[\w-]+)?(?=$|[\s'";|&)])/,'This touches an environment file that may hold secrets.'],
];
const SENSITIVE_PATH=/(?:^|\/)\.(?:ssh|aws|gnupg|kube)(?:\/|$)|\/\.netrc$|\/id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$|(?:^|\/)\.env(?!\.(?:example|sample|template)$)(?:\.[\w-]+)?$|\/(?:credentials|\.npmrc|\.pypirc)$/;
const ROOTISH=new Set(['/','/Users','/home','/System','/usr','/etc','/bin','/sbin','/Library','/Applications','/var','/opt','/private']);

function expand(value:string,cwd:string,home:string){
  const unquoted=value.replace(/^['"]|['"]$/g,'');
  const expanded=unquoted.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/,home);
  return path.resolve(cwd,expanded);
}
function inside(target:string,root:string){const rel=path.relative(root,target);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));}
/** Paths a session may change without extra confirmation: the workspace, temp dirs and the runtime's own project notes. */
function allowedWrite(target:string,cwd:string,home:string){
  const roots=[cwd,os.tmpdir(),'/tmp','/private/tmp','/var/folders','/private/var/folders','/dev/null',path.join(home,'.claude','projects'),path.join(home,'.claude','plans')];
  return roots.some(root=>target==='/dev/null'||inside(target,root));
}
// Split on command separators, keep quoted words together.
function segments(command:string){return command.split(/\n|;|&&|\|\||\|(?!\|)|&(?!&)/).map(part=>part.trim()).filter(Boolean);}
function words(segment:string){return (segment.match(/"[^"]*"|'[^']*'|\S+/g)||[]).map(word=>word.trim());}
/** The program and arguments a segment runs, without wrappers and VAR=value assignments. */
function commandWords(segment:string){
  const argv=words(segment.replace(/^[({]\s*/,''));
  while(argv.length&&(PREFIXES.has(argv[0])||/^\w+=/.test(argv[0])))argv.shift();
  return argv.map(word=>word.replace(/^['"]|['"]$/g,''));
}

function shellGate(command:string,cwd:string,home:string):Gate|undefined{
  const text=command.replace(/\\\n/g,' ');
  for(const [pattern,reason] of DENY_TEXT)if(pattern.test(text))return {decision:'deny',reason};
  for(const segment of segments(text)){const reason=denyCommand(commandWords(segment));if(reason)return {decision:'deny',reason};}
  for(const segment of segments(text)){
    const argv=commandWords(segment);
    if(argv[0]==='rm'||argv[0]?.endsWith('/rm')){
      const flags=argv.slice(1).filter(word=>/^-/.test(word)),targets=argv.slice(1).filter(word=>!/^-/.test(word));
      const recursive=flags.some(flag=>/^-[a-zA-Z]*[rR]/.test(flag)||flag==='--recursive');
      for(const raw of targets){
        const target=expand(raw.replace(/^(['"]?)(.*?)\/\*(['"]?)$/,'$1$2$3')||'/',cwd,home);
        if(recursive&&(ROOTISH.has(target)||target===home))return {decision:'deny',reason:'Recursively deleting the root, a system folder or the home folder is never done by the agent.'};
        if(!allowedWrite(target,cwd,home))return {decision:'ask',reason:'This deletes files outside the workspace.'};
      }
    }
    // Redirections and tee into files outside the workspace.
    const redirects=[...segment.matchAll(/(?:^|[^<>&\d])(?:\d?>>?|&>)\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)].map(match=>match[1]);
    if(argv[0]==='tee')redirects.push(...argv.slice(1).filter(word=>!/^-/.test(word)));
    for(const raw of redirects){
      if(/^&\d$/.test(raw))continue;
      if(!allowedWrite(expand(raw,cwd,home),cwd,home))return {decision:'ask',reason:'This writes a file outside the workspace.'};
    }
  }
  for(const [pattern,reason] of ASK)if(pattern.test(text))return {decision:'ask',reason};
}

/**
 * Classify one tool call. undefined means "no gate applies": the host's normal
 * permission flow decides. Paths resolve against the session working directory.
 */
export function toolGate(tool:string,input:any,cwd:string=process.cwd(),home:string=os.homedir()):Gate|undefined{
  const args=input&&typeof input==='object'?input:{};
  if(SHELL_TOOLS.has(tool)&&typeof args.command==='string')return shellGate(args.command,cwd,home);
  const file=args.file_path??args.filePath??args.notebook_path??args.path;
  if(typeof file!=='string'||!file)return undefined;
  const target=expand(file,cwd,home);
  if(SENSITIVE_PATH.test(target))return {decision:'ask',reason:READ_TOOLS.has(tool)?'This reads a file that may hold credentials.':'This changes a file that may hold credentials.'};
  if(WRITE_TOOLS.has(tool)&&!allowedWrite(target,cwd,home))return {decision:'ask',reason:'This changes a file outside the workspace.'};
}

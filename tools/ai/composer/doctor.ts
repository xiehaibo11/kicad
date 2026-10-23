import {readSettings} from './settings.ts';
import {promptAudit} from './prompt-audit.ts';
const cwd=process.cwd();
try{
  if(process.argv.slice(2).join(' ')!=='prompt-audit')throw Error('Usage: Kicad doctor prompt-audit');
  console.log(JSON.stringify({...promptAudit(cwd),...readSettings(cwd)},null,2));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}

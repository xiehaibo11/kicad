// Load the assembled production file/content handlers; only unused dependencies are stubbed.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
exports.loadHandlers=(root,vscode)=>{
 const requireRoot=createRequire(path.join(root,'package.json')),ts=requireRoot('typescript'),cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{module,exports:module.exports,process,console,require:name=>{
   if(name==='vscode')return vscode;
   if(['fs','path','os','node:crypto'].includes(name))return require(name);
   if(name==='../../../shared/imageFiles')return load(path.resolve(path.dirname(file),name+'.ts'));
   if(name==='../../../toolContent')return load(path.resolve(path.dirname(file),name+'.ts'));
   if(['../messageEditStore','../transport/AsyncStream'].includes(name))return {};
   throw Error('Unexpected open_file test dependency: '+name);
  }},{filename:file});
  return module.exports;
 }
 return {...load(path.join(root,'src/services/claude/handlers/handlers.ts')),...load(path.join(root,'src/toolContent.ts'))};
};
exports.loadHandler=(root,vscode)=>exports.loadHandlers(root,vscode).handleOpenFile;

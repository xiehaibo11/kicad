// Add /effort without replacing upstream /variants, model capabilities or state.
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2],dir=path.dirname(new URL(import.meta.url).pathname);
function patch(file,before,after){const target=path.join(root,file),s=fs.readFileSync(target,'utf8');if(s.split(before).length!==2)throw Error('Reasoning anchor missing/ambiguous: '+file);fs.writeFileSync(target,s.replace(before,()=>after))}
const app='packages/tui/src/app.tsx';
if(!fs.readFileSync(path.join(root,app),'utf8').includes('name: "kicad.effort"')){
patch(app,'        name: "variant.list",',`        name: "kicad.effort",
        title: "Choose reasoning effort", category: "Model", slashName: "effort",
        run: () => { dialog.replace(() => <DialogVariant />) },
      },
      {
        name: "variant.list",`);
}
fs.copyFileSync(path.join(dir,'overlay/packages/tui/src/component/dialog-variant.tsx'),path.join(root,'packages/tui/src/component/dialog-variant.tsx'));
// Provider capabilities and model-specific selection stay in upstream stores.
console.log('Applied model-specific /effort selector; native /variants retained.');

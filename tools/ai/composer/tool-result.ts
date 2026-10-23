// Preserve MCP media at the provider boundary. JSON-stringifying an MCP result
// hides screenshots from vision models, even though the host received pixels.
export function mcpResult(value:any):any {
  if(Array.isArray(value?.content))return {...value,isError:value.isError===true||value.ok===false};
  return {content:[{type:'text',text:JSON.stringify(value)}],isError:value?.ok===false};
}
export function codexToolResult(value:any){
  const result=mcpResult(value);
  const contentItems=result.content.flatMap((block:any)=>{
    if(block.type==='image'&&typeof block.data==='string'&&/^image\/(png|jpeg|webp|gif)$/.test(block.mimeType))return [{type:'inputImage',imageUrl:'data:'+block.mimeType+';base64,'+block.data}];
    if(block.type==='text')return [{type:'inputText',text:block.text}];
    return [];
  });
  // Codex dynamic outputs have no structuredContent field. Cua puts the exact
  // element handles and values there, so preserve that data as text alongside
  // the screenshot. Do not duplicate a server's existing JSON fallback.
  if(result.structuredContent!==undefined){
    const text=JSON.stringify(result.structuredContent);
    if(!result.content.some((block:any)=>{if(block.type!=='text')return false;try{return JSON.stringify(JSON.parse(block.text))===text;}catch{return false;}}))contentItems.push({type:'inputText',text});
  }
  return {contentItems,success:!result.isError};
}
export function chatToolContent(value:any){
  return mcpResult(value).content.map((block:any)=>block.type==='image'?{type:'image',source:{type:'base64',media_type:block.mimeType,data:block.data}}:block);
}
export function hasToolImages(value:any):boolean {
  return Array.isArray(value?.content)&&value.content.some((block:any)=>block.type==='image');
}

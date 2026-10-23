// Formats supported by VS Code's built-in imagePreview.previewEditor.
export interface EditorImage {filePath:string;name:string}
export function imageFile(value:unknown):EditorImage|undefined{
  if(typeof value!=='string'||!value||/[\0\r\n]/.test(value))return undefined;
  // File paths only; never turn a tool-provided URL into an executable link.
  if(/^[a-z][a-z\d+.-]*:/i.test(value)&&!/^\w:[\\/]/.test(value))return undefined;
  const name=value.split(/[\\/]/).at(-1)||'';
  return /\.(?:png|jpe?g|jpe|gif|webp|bmp|ico|avif|svg)$/i.test(name)?{filePath:value,name}:undefined;
}

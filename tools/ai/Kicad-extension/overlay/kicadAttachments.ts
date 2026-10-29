import * as vscode from 'vscode';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';

const MEDIA: Record<string, string> = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.pdf':'application/pdf'};
const MAX_FILE = 20 * 1024 * 1024, MAX_BATCH = 40 * 1024 * 1024;

// Explorer drops carry file URIs rather than readable browser File objects.
// Only explicitly dropped local resources are read; directories are references.
export async function readDroppedFiles(paths: unknown, cwd?: string) {
  const attachments: Array<{id:string;fileName:string;fileSize:number;mediaType:string;data:string}> = [];
  const references: Array<{path:string;directory:boolean}> = [], errors: string[] = [];
  if (!Array.isArray(paths) || paths.length > 100) throw new Error('一次最多拖入 100 个文件。');
  const base = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const seen = new Set<string>();
  let total = 0;
  for (const raw of paths) {
    try {
      if (typeof raw !== 'string' || !raw || raw.includes('\0')) throw new Error('无效文件路径。');
      const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[A-Za-z]:[\\/]/.test(raw);
      if (hasScheme && !/^file:/i.test(raw)) throw new Error('仅支持拖入本地文件。');
      const uri = hasScheme ? vscode.Uri.parse(raw) : vscode.Uri.file(path.resolve(base, raw));
      if (seen.has(uri.toString())) continue;
      seen.add(uri.toString());
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) { references.push({path:uri.fsPath,directory:true}); continue; }
      if (!(stat.type & vscode.FileType.File)) throw new Error('不是可读取的文件。');
      const fileName = path.basename(uri.fsPath), mediaType = MEDIA[path.extname(fileName).toLowerCase()];
      if (!mediaType) { references.push({path:uri.fsPath,directory:false}); continue; }
      if (stat.size > MAX_FILE) throw new Error('附件超过 20 MB，请改为输入文件路径引用。');
      if (total + stat.size > MAX_BATCH) throw new Error('本次附件总大小超过 40 MB。');
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_FILE || total + bytes.byteLength > MAX_BATCH) throw new Error('附件大小超出限制。');
      total += bytes.byteLength;
      attachments.push({id:randomUUID(),fileName,fileSize:bytes.byteLength,mediaType,data:Buffer.from(bytes).toString('base64')});
    } catch (error) { errors.push(`${typeof raw === 'string' ? path.basename(raw) : '文件'}：${error instanceof Error ? error.message : String(error)}`); }
  }
  return {attachments,references,errors};
}

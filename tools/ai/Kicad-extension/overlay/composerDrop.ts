// VS Code supplies the full selection in its internal URI list; text/uri-list
// can contain only the first selected file. Chromium lowercases custom types.
const URI_TYPES = ['application/vnd.code.uri-list', 'text/uri-list'];
const JSON_TYPES = ['codeeditors', 'resourceurls', 'codefiles'];

export interface FileTransferData {
  readonly types: readonly string[];
  readonly files?: ArrayLike<{name?:string;path?:string}>;
  getData(type: string): string;
}

export function isFileTransfer(transfer: FileTransferData | null): boolean {
  return !!transfer && Array.from(transfer.types || []).some(type =>
    [...URI_TYPES, ...JSON_TYPES, 'files'].includes(type.toLowerCase()));
}

function filePath(value: unknown): string | undefined {
  // CodeEditors serializes URI components rather than browser File objects.
  if (value && typeof value === 'object') {
    const resource = value as {scheme?:unknown;authority?:unknown;path?:unknown};
    if (resource.scheme !== 'file' || typeof resource.path !== 'string') return;
    let result = resource.path;
    if (resource.authority && resource.authority !== 'localhost') result = `//${resource.authority}${result}`;
    if (/^\/[A-Za-z]:\//.test(result)) result = result.slice(1);
    return result.includes('\0') || !/^(\/|[A-Za-z]:[\\/])/.test(result) ? undefined : result;
  }
  if (typeof value !== 'string' || !value || value.includes('\0')) return;
  if (/^file:/i.test(value)) {
    try {
      const uri = new URL(value);
      let result = decodeURIComponent(uri.pathname);
      if (uri.hostname && uri.hostname !== 'localhost') result = `//${uri.hostname}${result}`;
      if (/^\/[A-Za-z]:\//.test(result)) result = result.slice(1);
      return result.includes('\0') ? undefined : result;
    } catch { return; }
  }
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) return value;
}

export function droppedFilePaths(transfer: FileTransferData): string[] {
  const types = Array.from(transfer.types || []);
  const read = (type: string) => transfer.getData(types.find(item => item.toLowerCase() === type) || type);
  for (const type of [URI_TYPES[0], ...JSON_TYPES, URI_TYPES[1]]) {
    const raw = read(type);
    if (!raw) continue;
    let values: unknown[] = [];
    try {
      values = JSON_TYPES.includes(type) ? JSON.parse(raw) : raw.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
      if (!Array.isArray(values)) continue;
    } catch { continue; }
    const paths = [...new Set(values.map(value => filePath(type === 'codeeditors' ? (value as {resource?:unknown})?.resource : value)).filter((item): item is string => !!item))];
    if (paths.length) return paths;
  }
  return [...new Set(Array.from(transfer.files || []).map(file => filePath(file.path)).filter((item): item is string => !!item))];
}

export function fileMention(value: string, directory = false): string {
  const name = directory && !value.endsWith('/') ? `${value}/` : value;
  return `@${/[\s"\\]/.test(name) ? JSON.stringify(name) : name}`;
}

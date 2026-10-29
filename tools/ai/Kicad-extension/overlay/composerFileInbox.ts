import {randomUUID} from 'node:crypto';

/** Paths only, scoped to the sidebar composer. Delivery waits for the input to mount. */
export class ComposerFileInbox {
  private pending: Array<{id:string;paths:string[]}> = [];
  private ready = false;
  private inFlight?: string;

  constructor(private readonly post: (message:unknown) => void) {}

  enqueue(paths:string[]) {
    const unique = [...new Set(paths.filter(value => typeof value === 'string' && value && !value.includes('\0')))];
    if (!unique.length) throw new Error('未读取到文件路径。');
    if (unique.length + this.pending.reduce((count,item) => count + item.paths.length,0) > 100)
      throw new Error('待添加文件超过 100 个，请先处理当前附件。');
    this.pending.push({id:randomUUID(),paths:unique});
    this.notify();
    this.flush();
  }

  notify() {
    if (this.pending.length) this.post({type:'kicad_composer_files_available'});
  }

  attached() { this.ready = true; this.flush(); }
  detached() { this.ready = false; this.inFlight = undefined; }

  applied(id:unknown) {
    if (typeof id !== 'string' || id !== this.inFlight || id !== this.pending[0]?.id) return;
    this.pending.shift();
    this.inFlight = undefined;
    this.flush();
  }

  private flush() {
    if (!this.ready || this.inFlight || !this.pending.length) return;
    this.inFlight = this.pending[0].id;
    this.post({type:'kicad_composer_files',...this.pending[0]});
  }
}

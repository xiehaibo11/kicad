// SPDX-License-Identifier: AGPL-3.0-only
import { ref, shallowRef, computed, watch, onBeforeUnmount } from 'vue';
import { transport } from '../core/runtimeTransport';

export function usePromptOptimizer(editor: {
  getDraft(): string;
  getModel(): string;
  getSession(): unknown;
  isBusy(): boolean;
  setDraft(text: string): void;
}) {
  const optimizing = ref(false);
  const message = ref('');
  const error = ref('');
  const previous = shallowRef<{ source: string; result: string; session: unknown }>();
  let controller: AbortController | undefined;
  let revision = 0;
  watch(() => [editor.getDraft(),editor.getModel()], () => { revision++; }, {flush:'sync'});
  const canUndo = computed(() => !!previous.value && editor.getDraft() === previous.value.result && !optimizing.value);
  function cancel() {
    controller?.abort();
    controller = undefined;
    optimizing.value = false;
    message.value = '已取消，草稿未替换。';
  }
  async function optimize() {
    if (optimizing.value || editor.isBusy() || !editor.getDraft().trim()) return;
    const source = editor.getDraft();
    const startedAt = revision;
    const session = editor.getSession();
    const model = editor.getModel();
    const current = new AbortController();
    controller = current;
    optimizing.value = true;
    error.value = '';
    message.value = '正在优化提示词…';
    try {
      const response = await transport.optimizePrompt(source, model, current.signal);
      if (controller !== current || current.signal.aborted) return;
      if (revision !== startedAt || editor.getModel() !== model || editor.getDraft() !== source || editor.getSession() !== session || editor.isBusy()) {
        message.value = '草稿或会话已变化，未替换。';
        return;
      }
      optimizing.value = false;
      previous.value = { source, result: response.text, session };
      editor.setDraft(response.text);
      message.value = '已优化，尚未发送。';
    } catch (reason) {
      if (controller !== current || current.signal.aborted) return;
      error.value = reason instanceof Error ? reason.message : String(reason);
      message.value = '';
    } finally {
      if (controller === current) { controller = undefined; optimizing.value = false; }
    }
  }
  function undo() {
    const saved = previous.value;
    if (!saved || !canUndo.value || editor.isBusy() || editor.getSession() !== saved.session) return;
    editor.setDraft(saved.source);
    previous.value = undefined;
    message.value = '已恢复优化前的草稿。';
  }
  onBeforeUnmount(() => controller?.abort());
  return { optimizing, message, error, canUndo, optimize, cancel, undo };
}

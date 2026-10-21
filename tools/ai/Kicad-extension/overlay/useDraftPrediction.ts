// SPDX-License-Identifier: AGPL-3.0-only
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { effect } from "alien-signals";
import { transport } from "../core/runtimeTransport";
import type { Session } from "../core/Session";
import {predictionLines, type ConversationLine} from "../../../kicadPrediction";
let initialEnabled = true;
try { initialEnabled = localStorage.getItem("kicad_draft_suggestions") !== "false"; } catch {}
export const draftSuggestionsEnabled = ref(initialEnabled);
watch(draftSuggestionsEnabled, value => {
  try { localStorage.setItem("kicad_draft_suggestions", String(value)); } catch {}
});
export function useDraftPrediction(editor: {
  getSession(): Session | undefined;
  getModel(): string;
  getDraft(): string;
  blocked(): boolean;
  setDraft(text: string): void;
}) {
  const text = ref("");
  const notice = ref("");
  const enabled = draftSuggestionsEnabled;
  let controller: AbortController | undefined;
  let currentSession: Session | undefined;
  let wasBusy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function invalidate() {
    controller?.abort();
    controller = undefined;
    clearTimeout(timer);
    text.value = "";
    notice.value = "";
  }
  async function generate(session: Session) {
    if (!enabled.value || editor.getDraft() || editor.blocked()) return;
    invalidate();
    const current = new AbortController();
    controller = current;
    const model = editor.getModel();
    const history: ConversationLine[] = session
      .messages()
      .filter(message => message.type === "user" || message.type === "assistant")
      .slice(-8)
      .flatMap((message) => {
        if (message.type !== "user" && message.type !== "assistant") return [];
        const content = message.message.content;
        const text =
          typeof content === "string"
            ? content
            : content
                .map((wrapper) =>
                  wrapper.content.type === "text" ? wrapper.content.text : "",
                )
                .join("\n");
        return [{ role: message.type, text }];
      });
    if (!history.length) return;
    try {
      const result = await transport.predictDraft(
        predictionLines(history),
        model,
        current.signal,
      );
      if (
        controller === current &&
        !current.signal.aborted &&
        editor.getSession() === session &&
        model === editor.getModel() &&
        !editor.getDraft() &&
        !editor.blocked()
      )
        text.value = result.text;
    } catch (error) {
      if (controller === current && !current.signal.aborted)
        notice.value =
          "当前模型未能生成下一句建议：" +
          (error instanceof Error ? error.message : String(error)).slice(
            0,
            240,
          );
    }
  }
  const stop = effect(() => {
    const session = editor.getSession();
    const busy = session?.busy() || session?.isLoading() || false;
    if (currentSession !== session) {
      invalidate();
      currentSession = session;
      wasBusy = busy;
      return;
    }
    const finished = wasBusy && !busy;
    wasBusy = busy;
    if (busy) invalidate();
    if (finished && session && !session.error())
      timer = setTimeout(() => void generate(session), 500);
  });
  watch(
    () => [editor.getDraft(), editor.getModel(), enabled.value],
    () => invalidate(),
  );
  watch(
    () => editor.blocked(),
    (value) => {
      if (value) invalidate();
    },
  );
  const visible = computed(
    () =>
      enabled.value && !!text.value && !editor.getDraft() && !editor.blocked(),
  );
  function accept() {
    if (!visible.value) return;
    const draft = text.value;
    invalidate();
    editor.setDraft(draft);
  }
  onBeforeUnmount(() => {
    stop();
    invalidate();
  });
  return { text, notice, visible, enabled, accept, dismiss: invalidate };
}

// SPDX-License-Identifier: MIT
import {
  createEffect,
  createSignal,
  onCleanup,
  untrack,
  createResource,
  createMemo,
} from "solid-js";
import { useBindings } from "../../keymap";
import { useSDK } from "../../context/sdk";
import { useDialog } from "../../ui/dialog";
import { DialogAlert } from "../../ui/dialog-alert";
import { DialogSelect } from "../../ui/dialog-select";
import { useTheme } from "../../context/theme";
import type { ConversationLine } from "../../kicad-prediction";

type ToolReference = {
  name: string;
  description: string;
  schema: string;
  access: string;
};
export function useKiCadComposer(editor: {
  model(): string | undefined;
  session(): string | undefined;
  busy(): boolean;
  draft(): string;
  blocked(): boolean;
  history(): ConversationLine[];
  setDraft(text: string): void;
  enabled(): boolean;
  setEnabled(value: boolean): void;
}) {
  const sdk = useSDK();
  const [suggestion, setSuggestion] = createSignal("");
  const [optimizing, setOptimizing] = createSignal(false);
  const [notice, setNotice] = createSignal("");
  let prediction: AbortController | undefined;
  let optimization: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draftRevision = 0;
  let previous:
    | { source: string; result: string; session: string | undefined }
    | undefined;
  async function request<T>(
    pathname: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(pathname, sdk.url);
    if (sdk.directory) url.searchParams.set("directory", sdk.directory);
    const response = await sdk.fetch(url.toString(), {
      method: body ? "POST" : "GET",
      headers: {
        ...Object.fromEntries(new Headers(sdk.headers).entries()),
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!response.ok) throw new Error((await response.text()).slice(0, 1000));
    return response.json() as Promise<T>;
  }
  function dismiss() {
    prediction?.abort();
    prediction = undefined;
    clearTimeout(timer);
    setSuggestion("");
  }
  let lastSession: string | undefined;
  let wasBusy = false;
  createEffect(() => {
    const session = editor.session(),
      busy = editor.busy();
    if (session !== lastSession) {
      dismiss();
      optimization?.abort();
      setOptimizing(false);
      setNotice("");
      lastSession = session;
      wasBusy = busy;
      return;
    }
    const finished = wasBusy && !busy;
    wasBusy = busy;
    if (busy) dismiss();
    if (finished && session) timer = setTimeout(() => void generate(), 500);
  });
  // Read the draft/model on every change so a transient edit also invalidates a late response.
  createEffect(() => {
    editor.draft();
    editor.model();
    editor.blocked();
    draftRevision++;
    untrack(dismiss);
  });
  createEffect(() => {
    if (!editor.enabled() || editor.blocked()) untrack(dismiss);
  });
  async function generate() {
    const model = editor.model(),
      session = editor.session();
    if (
      !model ||
      !session ||
      !editor.enabled() ||
      editor.draft() ||
      editor.blocked() ||
      editor.busy() ||
      optimizing()
    )
      return;
    dismiss();
    const current = new AbortController();
    prediction = current;
    try {
      const result = await request<{ text: string }>(
        "/kicad/composer",
        { mode: "predict", model, history: editor.history(), text: "" },
        current.signal,
      );
      if (
        prediction === current &&
        !current.signal.aborted &&
        editor.model() === model &&
        editor.session() === session &&
        !editor.draft() &&
        !editor.busy() &&
        !editor.blocked()
      )
        setSuggestion(result.text);
    } catch (error) {
      if (prediction === current && !current.signal.aborted)
        setNotice(
          "Couldn't suggest a next message: " +
            (error instanceof Error ? error.message : String(error)).slice(
              0,
              240,
            ),
        );
    }
  }
  function accept() {
    if (!suggestion() || editor.draft() || editor.busy() || editor.blocked())
      return false;
    const text = suggestion();
    dismiss();
    editor.setDraft(text);
    return true;
  }
  function cancel() {
    optimization?.abort();
    optimization = undefined;
    setOptimizing(false);
    setNotice("Cancelled; the draft was not replaced.");
  }
  async function optimize() {
    if (
      optimizing() ||
      editor.busy() ||
      editor.blocked() ||
      !editor.draft().trim() ||
      !editor.model()
    )
      return;
    dismiss();
    const startedAt = draftRevision,
      source = editor.draft(),
      model = editor.model(),
      session = editor.session(),
      current = new AbortController();
    optimization = current;
    setOptimizing(true);
    setNotice("Optimizing with the current model…");
    try {
      const result = await request<{ text: string }>(
        "/kicad/composer",
        { mode: "optimize", model, text: source, history: [] },
        current.signal,
      );
      if (optimization !== current || current.signal.aborted) return;
      if (
        startedAt !== draftRevision ||
        source !== editor.draft() ||
        model !== editor.model() ||
        session !== editor.session() ||
        editor.busy() ||
        editor.blocked()
      ) {
        setNotice("The draft, attachments, model or session changed; not replaced.");
        return;
      }
      previous = { source, result: result.text, session };
      editor.setDraft(result.text);
      setNotice("Optimized, not sent. Undo from the command palette.");
    } catch (e) {
      if (optimization === current && !current.signal.aborted)
        setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      if (optimization === current) {
        optimization = undefined;
        setOptimizing(false);
      }
    }
  }
  function undo() {
    if (
      previous &&
      editor.session() === previous.session &&
      editor.draft() === previous.result &&
      !editor.busy() &&
      !editor.blocked() &&
      !optimizing()
    ) {
      editor.setDraft(previous.source);
      previous = undefined;
      setNotice("Original draft restored.");
    }
  }
  onCleanup(() => {
    dismiss();
    optimization?.abort();
  });
  return {
    suggestion,
    optimizing,
    notice,
    accept,
    dismiss,
    optimize,
    cancel,
    undo,
    generate,
    async health(dialog: ReturnType<typeof useDialog>) {
      try { const result = await request<{text:string}>("/kicad/health"); await DialogAlert.show(dialog, "KiCad connection", result.text); }
      catch (error) { setNotice(String(error)); }
    },
    toggle: () => {
      editor.setEnabled(!editor.enabled());
      setNotice(editor.enabled() ? "Next-message suggestions on" : "Next-message suggestions off");
    },
    async tools() {
      return request<{ tools: ToolReference[] }>("/kicad/tool-references");
    },
  };
}
export function KiCadToolDialog(props: {
  load: () => Promise<{ tools: ToolReference[] }>;
  insert: (text: string) => void;
}) {
  const dialog = useDialog(),
    { theme } = useTheme();
  const [error, setError] = createSignal("");
  const [data] = createResource(() =>
    props.load().catch((e) => {
      setError(String(e));
      return { tools: [] };
    }),
  );
  const options = createMemo(() =>
    (data()?.tools ?? []).map((tool) => ({
      title: tool.name,
      description: tool.description,
      value: tool.name,
      category: tool.access,
      onSelect: () => {
        props.insert(
          `Tool reference: ${tool.name}\nPurpose: ${tool.description}\nAccess: ${tool.access}\nInput schema:\n${tool.schema}\n`,
        );
        dialog.clear();
      },
    })),
  );
  return (
    <DialogSelect
      title="KiCad tool reference · selecting inserts it into the draft; nothing runs"
      placeholder="Search tool name or purpose…"
      options={options()}
      emptyView={
        <text fg={theme.textMuted}>
          {error() || "Loading tools, or no tools are available."}
        </text>
      }
    />
  );
}

// A focused textarea layer takes precedence over Tab's normal agent-cycle binding.
// It disappears immediately after acceptance, restoring all upstream key bindings.
export function useKiCadPredictionKeys(
  composer: ReturnType<typeof useKiCadComposer>,
  input: () => import("@opentui/core").TextareaRenderable | undefined,
  disabled: () => boolean,
  autocomplete: () => boolean,
) {
  useBindings(() => ({
    target: input,
    enabled: () =>
      !!composer.suggestion() &&
      !input()?.plainText &&
      !disabled() &&
      !autocomplete(),
    bindings: [
      ...["tab"].map((key) => ({
        key,
        desc: "Accept the suggested next message (does not send)",
        cmd: () => {
          composer.accept();
        },
      })),
      {
        key: "escape",
        desc: "Dismiss the suggested next message",
        cmd: () => {
          composer.dismiss();
        },
      },
    ],
  }));
}

// Append through the editor so existing attachment extmarks and offsets survive.
export function insertKiCadToolReference(
  input: import("@opentui/core").TextareaRenderable,
  text: string,
  update: (value: string) => void,
) {
  const prefix = input.plainText ? "\n" : "";
  input.gotoBufferEnd();
  input.insertText(prefix + text);
  update(input.plainText);
}

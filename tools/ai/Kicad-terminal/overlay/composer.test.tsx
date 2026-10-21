/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { SDKProvider } from "../src/context/sdk";
import { useKiCadComposer } from "../src/component/prompt/kicad-composer";
test("KiCad composer preserves drafts, model, cancellation, session and explicit send", async () => {
  const [draft, setDraft] = createSignal(""),
    [busy, setBusy] = createSignal(false),
    [session, setSession] = createSignal<string | undefined>("s1"),
    [model, setModel] = createSignal("test/current"),
    [enabled, setEnabled] = createSignal(true);
  const calls: { url: string; payload: Record<string, unknown> }[] = [];
  let response = "请解释 U1 和 R1 的检查结果，不修改文件。";
  let pending: ((value: Response) => void) | undefined;
  let hold = false;
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const payload = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), payload });
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer fixture",
    );
    if (hold)
      return new Promise<Response>((resolve) => {
        pending = resolve;
      });
    return Response.json({
      text: response,
      tools: [
        {
          name: "kicad_kicad_health",
          description: "Definition fixture",
          schema: "{}",
          access: "只读",
        },
      ],
    });
  }) as unknown as typeof fetch;
  let composer!: ReturnType<typeof useKiCadComposer>;
  function Harness() {
    composer = useKiCadComposer({
      draft,
      busy,
      session,
      model,
      enabled,
      setEnabled,
      blocked: () => false,
      history: () => [
        { role: "user", text: "只检查 U1 和 R1，不修改文件。" },
        { role: "assistant", text: "检查已完成。" },
      ],
      setDraft,
    });
    return <text>{composer.suggestion()}</text>;
  }
  const app = await testRender(
    () => (
      <SDKProvider
        url="http://fixture"
        directory="/project"
        fetch={fetcher}
        headers={{ authorization: "Bearer fixture" }}
        events={{ subscribe: async () => () => {} }}
      >
        <Harness />
      </SDKProvider>
    ),
    { width: 80, height: 24 },
  );
  try {
    setBusy(true);
    await Bun.sleep(20);
    setBusy(false);
    await Bun.sleep(650);
    expect(composer.suggestion()).toBe(response);
    expect(draft()).toBe("");
    expect(calls[0]?.payload.model).toBe("test/current");
    expect(calls[0]?.payload.mode).toBe("predict");
    expect(composer.accept()).toBe(true);
    expect(draft()).toBe(response);
    expect(composer.suggestion()).toBe("");
    expect(calls.length).toBe(1);
    setDraft("只查看 PCB，不布线。");
    response = "请只查看 PCB 并报告，不进行布线。";
    await composer.optimize();
    expect(draft()).toBe(response);
    composer.undo();
    expect(draft()).toBe("只查看 PCB，不布线。");
    hold = true;
    const optimization = composer.optimize();
    await Bun.sleep(20);
    setDraft("我的新草稿");
    pending!(Response.json({ text: "过期优化" }));
    await optimization;
    expect(draft()).toBe("我的新草稿");
    const cancelled = composer.optimize();
    await Bun.sleep(20);
    composer.cancel();
    pending!(Response.json({ text: "取消后的结果" }));
    await cancelled;
    expect(draft()).toBe("我的新草稿");
    setDraft("");
    hold = false;
    await composer.generate();
    expect(composer.suggestion()).toBe(response);
    setModel("test/changed");
    await Bun.sleep(20);
    expect(composer.suggestion()).toBe("");
    hold = true;
    const prediction = composer.generate();
    await Bun.sleep(20);
    setSession("s2");
    await Bun.sleep(20);
    pending!(Response.json({ text: "旧会话建议" }));
    await prediction;
    expect(composer.suggestion()).toBe("");
    hold = false;
    setEnabled(false);
    const before = calls.length;
    await composer.generate();
    expect(calls.length).toBe(before);
    expect((await composer.tools()).tools[0]?.name).toBe("kicad_kicad_health");
    expect(
      calls.every((call) => new URL(call.url).pathname.startsWith("/kicad/")),
    ).toBe(true);
  } finally {
    app.renderer.destroy();
  }
});

import { TextareaRenderable } from "@opentui/core";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { useRenderer } from "@opentui/solid";
import { onCleanup } from "solid-js";
import {
  OpencodeKeymapProvider,
  registerOpencodeKeymap,
  useBindings,
} from "../src/keymap";
import { useKiCadPredictionKeys } from "../src/component/prompt/kicad-composer";
import { createTuiResolvedConfig } from "./fixture/tui-runtime";

test("real terminal key events accept once, never submit and restore upstream Tab", async () => {
  let composer!: ReturnType<typeof useKiCadComposer>;
  let input: TextareaRenderable | undefined;
  const [draft, setDraft] = createSignal("");
  let sent = 0,
    cycled = 0;
  const fetcher = (async () =>
    Response.json({
      text: "请解释检查结果，继续只读。",
    })) as unknown as typeof fetch;
  function Editor() {
    composer = useKiCadComposer({
      model: () => "fixture/current",
      session: () => "ses_fixture",
      busy: () => false,
      draft,
      blocked: () => false,
      history: () => [{ role: "user", text: "只读检查" }],
      setDraft: (text) => {
        input!.setText(text);
        setDraft(text);
      },
      enabled: () => true,
      setEnabled: () => {},
    });
    useBindings(() => ({
      bindings: [
        {
          key: "tab",
          cmd: () => {
            cycled++;
          },
        },
      ],
    }));
    useKiCadPredictionKeys(
      composer,
      () => input,
      () => false,
      () => false,
    );
    return (
      <textarea
        ref={(value) => {
          input = value;
          value.focus();
        }}
        onContentChange={() => setDraft(input!.plainText)}
        onSubmit={() => {
          sent++;
        }}
      />
    );
  }
  function Harness() {
    const renderer = useRenderer(),
      keymap = createDefaultOpenTuiKeymap(renderer);
    onCleanup(
      registerOpencodeKeymap(keymap, renderer, createTuiResolvedConfig()),
    );
    return (
      <OpencodeKeymapProvider keymap={keymap}>
        <SDKProvider
          url="http://fixture"
          fetch={fetcher}
          events={{ subscribe: async () => () => {} }}
        >
          <Editor />
        </SDKProvider>
      </OpencodeKeymapProvider>
    );
  }
  const app = await testRender(() => <Harness />, {
    width: 80,
    height: 24,
    kittyKeyboard: true,
  });
  try {
    await composer.generate();
    await Bun.sleep(20);
    app.mockInput.pressTab();
    await Bun.sleep(20);
    expect(input!.plainText).toBe("请解释检查结果，继续只读。");
    expect(sent).toBe(0);
    expect(cycled).toBe(0);
    app.mockInput.pressTab();
    await Bun.sleep(20);
    expect(cycled).toBe(1);
    input!.clear();
    setDraft("");
    await composer.generate();
    await Bun.sleep(20);
    app.mockInput.pressEnter();
    await Bun.sleep(20);
    expect(input!.plainText).toBe("");
    expect(composer.suggestion()).toBe("请解释检查结果，继续只读。");
    expect(sent).toBe(1);
    app.mockInput.pressArrow("right");
    await Bun.sleep(20);
    expect(input!.plainText).toBe("");
    app.mockInput.pressTab();
    await Bun.sleep(20);
    expect(input!.plainText).toBe("请解释检查结果，继续只读。");
    expect(sent).toBe(1);
  } finally {
    app.renderer.destroy();
  }
});

import { insertKiCadToolReference } from "../src/component/prompt/kicad-composer";
test("tool references append at end without losing attachment extmarks", async () => {
  let input!: TextareaRenderable,
    saved = "";
  const app = await testRender(
    () => (
      <textarea
        ref={(value) => {
          input = value;
          value.focus();
        }}
      />
    ),
    { width: 80, height: 24 },
  );
  try {
    input.setText("[Image #1] inspect U1");
    const type = input.extmarks.registerType("fixture-attachment");
    const mark = input.extmarks.create({
      start: 0,
      end: 10,
      typeId: type,
      virtual: false,
    });
    input.gotoBufferHome();
    insertKiCadToolReference(
      input,
      "工具参考：kicad_health",
      (value) => (saved = value),
    );
    expect(input.plainText).toBe(
      "[Image #1] inspect U1\n工具参考：kicad_health",
    );
    expect(saved).toBe(input.plainText);
    expect(input.extmarks.get(mark)?.start).toBe(0);
    expect(input.extmarks.get(mark)?.end).toBe(10);
  } finally {
    app.renderer.destroy();
  }
});

test('an attachment added during optimization must survive late completion', async () => {
  const [draft,setDraft]=createSignal('只检查 U1，不要修改。')
  const [parts,setParts]=createSignal<string[]>([])
  let release: (response: Response) => void = () => {}
  let composer!: ReturnType<typeof useKiCadComposer>
  function Harness() {
    composer=useKiCadComposer({draft,busy:()=>false,session:()=> 's1',model:()=> 'test/current',enabled:()=>false,setEnabled:()=>{},blocked:()=>parts().length>0,history:()=>[],
      setDraft:text=>{setDraft(text);setParts([])} })
    return <text>{draft()}</text>
  }
  const app=await testRender(()=><SDKProvider url="http://fixture" fetch={(async()=>new Promise<Response>(resolve=>{release=resolve})) as unknown as typeof fetch} events={{subscribe:async()=>()=>{}}}><Harness/></SDKProvider>,{width:80,height:10})
  try {
    const pending=composer.optimize()
    await Bun.sleep(30)
    setParts(['new-attachment.png'])
    await Bun.sleep(30)
    release(Response.json({text:'请只读检查 U1，不做修改。'}))
    await pending
    console.log(JSON.stringify({draft:draft(),remainingAttachments:parts(),lateOptimizationReplacedDraft:draft()!=='只检查 U1，不要修改。'}))
    expect(parts()).toEqual(['new-attachment.png'])
    expect(draft()).toBe('只检查 U1，不要修改。')
    setParts([])
    const transient=composer.optimize()
    await Bun.sleep(20)
    setParts(['transient.png'])
    await Bun.sleep(20)
    setParts([])
    await Bun.sleep(20)
    release(Response.json({text:'过期的优化'}))
    await transient
    expect(draft()).toBe('只检查 U1，不要修改。')
  } finally {app.renderer.destroy()}
})

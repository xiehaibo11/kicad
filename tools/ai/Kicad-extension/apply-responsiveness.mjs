import fs from 'node:fs';
import path from 'node:path';

// Keep the chat responsive while a turn runs and when the panel first opens.
// Claude Code 2.1.30x emits a stream_event plus a system/thinking_tokens message
// for every token; none has a chat representation, yet each crossed the webview
// bridge, was logged twice and republished the whole message list. New output
// also yanked the conversation to the bottom, so text could not be selected and
// earlier controls moved away while the agent worked.
export function applyResponsiveness(root) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  function patch(file, before, after) {
    const source = read(file);
    if (source.split(before).length !== 2)
      throw Error('Responsiveness anchor missing/ambiguous: ' + file + ' ' + before.slice(0, 80));
    fs.writeFileSync(path.join(root, file), source.replace(before, () => after));
  }

  // No consumer renders partial messages; the final assistant message carries the text.
  patch('src/services/claude/ClaudeSdkService.ts', '            includePartialMessages: true\n', '            includePartialMessages: false\n');
  patch('src/services/claude/ClaudeAgentService.ts', "                        messageCount++;\n                        this.logService.info(`  ← 收到消息 #${messageCount}: ${message.type}`);\n", `                        messageCount++;
                        // Token-level progress has no chat representation.
                        if (message.type === 'stream_event' || (message.type === 'system' && (message as any).subtype === 'thinking_tokens')) continue;
                        this.logService.info(\`  ← 收到消息 #\${messageCount}: \${message.type}\`);
`);

  const session = 'src/webview/src/core/Session.ts';
  patch(session, '    // this.messages(merged);\n    this.messages(currentMessages);\n', `    // this.messages(merged);
    // Progress-only events add nothing; a fresh array would re-render the timeline.
    if (currentMessages.length !== this.messages().length || event?.type === 'user') this.messages(currentMessages);
`);

  // Slash commands and model discovery start the CLIs (seconds). They update
  // reactively, so model selection and the first send never wait for them.
  const transport = 'src/webview/src/transport/BaseTransport.ts';
  patch(transport, `    const claudeState = await this.sendRequest<GetClaudeStateResponse>({
      type: "get_claude_state",
    });
    this.claudeConfig(claudeState.config);
    this.state("connected");`, `    this.state("connected");
    void this.sendRequest<GetClaudeStateResponse>({ type: "get_claude_state" })
      .then(claudeState => {
        this.claudeConfig(claudeState.config);
        registerReasoningModels((claudeState.config as any)?.models);
      })
      .catch(error => console.warn("Claude configuration discovery failed", error));`);

  // Follow new output only while the reader is at the bottom, and never move the
  // conversation under an active selection. Starting a turn resumes following.
  const page = 'src/webview/src/pages/ChatPage.vue';
  patch(page, '          ref="containerEl"\n', '          ref="containerEl"\n          @scroll.passive="updateFollow"\n');
  patch(page, `  watch(
    () => messages.value.length,
    async len => {
      const increased = len > prevCount;
      prevCount = len;
      if (increased) {
        await nextTick();
        scrollToBottom();
      }
    }
  );`, `  let followOutput = true;
  function updateFollow(): void {
    const el = containerEl.value;
    if (el) followOutput = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }
  function selectingInConversation(): boolean {
    const selection = window.getSelection();
    return !!selection && !selection.isCollapsed && !!containerEl.value?.contains(selection.anchorNode);
  }
  watch(isBusy, async (busy, was) => {
    if (!busy || was) return;
    followOutput = true;
    await nextTick();
    scrollToBottom();
  });

  watch(
    () => messages.value.length,
    async len => {
      const increased = len > prevCount;
      prevCount = len;
      if (increased && followOutput && !selectingInConversation()) {
        await nextTick();
        scrollToBottom();
      }
    }
  );`);
}

// Shared backend policy. This detects underspecified inputs and conversational
// turns so the host can give the model useful context. Ordinary tool selection
// stays with the model; explicit delegation authorization is enforced separately.
export function needsClarification(text:string):boolean {
  const value=text.replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g,'').trim();
  return !value || /^[\d\s.,，。!?！？:：;；+\-]+$/.test(value)
    || /^(你好|您好|嗨|哈喽|hello|hi|hey|测试|test)[！!。.\s]*$/i.test(value);
}
export const CLARIFY_HINT='The request may be underspecified. If you need information that is not already in the conversation, ask the user before acting; otherwise answer directly. You decide whether a tool is needed.';
export const TOOL_USE_GUIDANCE='Interpret the latest submitted natural-language request before using any tool. Answer conversation, acknowledgements and explanations from available context directly when they need no external evidence. Never run a fixed startup or per-turn checklist of tool search, skills, MCP discovery, health, Git or todos. Select a tool only to resolve a concrete missing fact or perform an action needed for the authorized task; use existing results first, avoid repeated discovery or unchanged reads, and stop when the request is satisfied. A tool being available, a successful previous call, or permission approval never creates another task. No slash command is required. Tool choice belongs to you: this guidance is advisory, not a permission gate.';
const CONVERSATION_HINT='This message looks conversational. Prefer answering from the existing conversation. If you decide that evidence or an action is required, you may use a tool; otherwise do not start a discovery or startup checklist.';
const NO_TOOL_HINT='The user asked not to use tools for this answer. Respect that unless the request cannot be answered safely from the conversation; in that case explain what is missing instead of silently starting tools.';
export function toolUseAdvice(text:string):string|undefined {
  if(needsClarification(text))return CLARIFY_HINT;
  const value=text.replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g,'').trim();
  if(/(?:不要|不需要|无需|禁止)(?:再)?(?:调用|使用|运行)?(?:任何)?工具|(?:do not|don't|without|no)\s+(?:use\s+|using\s+|call\s+|calling\s+|any\s+)*tools\b/i.test(value))return NO_TOOL_HINT;
  if(/^(?:谢谢(?:你)?|多谢|好的|好|明白了|了解了|知道了|收到|辛苦了|再见|你是谁|你叫什么(?:名字)?|介绍一下你自己|thanks?(?: you)?|thank you|ok(?:ay)?|got it|understood|bye|who are you)[！!。.？?，,\s]*$/i.test(value))return CONVERSATION_HINT;
}
export function questionAnswers(inputs:Record<string,unknown>):boolean {
  const questions=inputs.questions,answers=inputs.answers;
  if(!Array.isArray(questions)||!questions.length||!answers||typeof answers!=='object')return false;
  return questions.every(q=>q && typeof q.question==='string' && typeof (answers as Record<string,unknown>)[q.question]==='string' && String((answers as Record<string,unknown>)[q.question]).trim().length>0);
}
// Sub-agents start only when the user asks for them. Detection is deliberately
// narrow: an explicit request for sub-agents, delegation or parallel agents (or a
// named domain sub-agent) in the submitted message. Everything else stays in the
// main agent, for every model.
/** Attached/quoted material can describe delegation without authorizing it. */
export function submittedRequest(text:string):string {
  const value=text.replace(/<(ide_selection|ide_context|system-reminder|attachment|document|file_content|history|prior_conversation|instructions)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1[^\n]*$/gm,' ')
    .replace(/^\s*>.*$/gm,' ').replace(/`(kicad-(?:reviewer|verifier))`/g,'$1').replace(/`[^`\n]*`/g,' ')
    .replace(/"[^"\n]*"|“[^”\n]*”|「[^」\n]*」/g,' ');
  // Locate the human-request heading only after removing quoted material: a
  // heading inside a document/history block must not become a new trust boundary.
  const request=/^#{1,6}\s*(?:My request|我的请求|用户请求)\s*[:：]?\s*$/im.exec(value);
  return request?value.slice(request.index+request[0].length):value;
}
const AGENT='(?:sub[ -]?agents?|agents?|workers?|kicad-(?:reviewer|verifier))';
const REQUEST=new RegExp('(?:^|\\b(?:and|then)\\s+)(?:(?:please|now|also)\\s+)*(?:(?:can|could|would|will)\\s+you\\s+|I\\s+(?:want|need)\\s+you\\s+to\\s+|I[’\']d\\s+like\\s+you\\s+to\\s+)?(?:spawn|launch|start|create|use|run|dispatch|assign|have|ask)\\s+(?:(?:an?|the|some|multiple|several|two|three|\\d+)\\s+)?(?:(?:parallel|explore|verification|review)\\s+)?'+AGENT+'\\b|^(?:please\\s+)?delegate\\b','i');
const CHINESE_REQUEST=/(?:^|然后|并且|同时|并)(?:请|现在|帮我|麻烦)?\s*(?:启动|派出?|开启?|使用|用|调用|让|安排|创建|分配给|交给)\s*(?:一|两|二|三|几|多|\d+)?\s*(?:个|些)?\s*(?:子\s*)?(?:代理|智能体|agents?)(?![a-z_-])|^(?:请)?(?:用)?(?:多代理|多个代理|并行代理|子代理)(?:来|去|并行)?(?:检查|审查|分析|执行|调查)|^(?:请)?(?:让|用|使用)\s*kicad-(?:reviewer|verifier)\b|^(?:请)?(?:委派|分派给)/i;
export function explicitDelegation(text:string):boolean {
  const value=submittedRequest(text);
  if(/(?:不要|不用|别|无需|禁止)\s*(?:再)?\s*(?:用|使用|启动|开|派)?\s*(?:子\s*)?(?:代理|智能体|agents?)|\b(?:do not|don't|never|no)\s+(?:use\s+|spawn\s+|launch\s+|start\s+)?(?:sub[ -]?)?agents?\b/i.test(value))return false;
  return value.split(/[\n。！？!?;；]|(?<!\d)\.(?:\s|$)|[,，](?:\s*)/).some(part=>{
    const clause=part.trim().replace(/^(?:[-*]|\d+[.)])\s+/, '');
    const request=REQUEST.exec(clause)||CHINESE_REQUEST.exec(clause);
    if(!request)return false;
    // Reject a descriptive object (use subagent architecture as reference),
    // while allowing a real request to study that architecture with a subagent.
    if(/^\s*(?:orchestration|architecture|structures?|logic|implementation|code|policy|settings|tools?)\b|^(?:的)?(?:编排|架构|机制|逻辑|结构|工具|设置|实现)/i.test(clause.slice(request.index+request[0].length)))return false;
    if(/\b(?:only when|only if|unless)\b.*\b(?:user|explicitly|requests?)\b|(?:仅当|只有|仅限).*(?:用户|明确|要求)/i.test(clause))return false;
    return true;
  });
}
export const SUBAGENT_TOOLS=new Set(['Agent','Task','task']);
export const DELEGATION_DENIED='Sub-agents start only when the user explicitly asks for sub-agents, delegation or parallel agents in the current request. Continue this work yourself with the available tools; do not retry the sub-agent call.';

// Shared backend policy. This detects underspecified inputs, not user intent
// in general: the model must still clarify missing targets in ordinary prose.
export function needsClarification(text:string):boolean {
  const value=text.replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g,'').trim();
  return !value || /^[\d\s.,，。!?！？:：;；+\-]+$/.test(value)
    || /^(你好|您好|嗨|哈喽|hello|hi|hey|测试|test)[！!。.\s]*$/i.test(value);
}
export const CLARIFY_FIRST='用户尚未提供明确任务。请先询问用户具体需求并等待回答；不要把数字、工具授权或历史记录猜成任务，不要调用业务工具或启动子代理。';
export function questionAnswers(inputs:Record<string,unknown>):boolean {
  const questions=inputs.questions,answers=inputs.answers;
  if(!Array.isArray(questions)||!questions.length||!answers||typeof answers!=='object')return false;
  return questions.every(q=>q && typeof q.question==='string' && typeof (answers as Record<string,unknown>)[q.question]==='string' && String((answers as Record<string,unknown>)[q.question]).trim().length>0);
}

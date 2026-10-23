// Runtime budgets come from facts the runtime reports (its context window),
// never from a vendor, model or family name. An unknown window uses one neutral
// default, so every tool-capable model gets the same behavior and prompt text.
export const DEFAULT_CONTEXT_WINDOW=128000;
export const SEARCH_PAGE_SIZE=5;

export interface RuntimeLimits {
  contextWindow:number;
  /** Characters of one tool result kept inline before it is archived and previewed. */
  resultChars:number;
  /** Capability-search results (with schemas) returned per page. */
  searchPage:number;
}

export function runtimeLimits(contextWindow?:number|null):RuntimeLimits {
  const window=typeof contextWindow==='number'&&Number.isFinite(contextWindow)&&contextWindow>0?Math.floor(contextWindow):DEFAULT_CONTEXT_WINDOW;
  return {
    contextWindow:window,
    resultChars:window>=200000?50000:window>=100000?30000:12000,
    searchPage:window<=64000?3:SEARCH_PAGE_SIZE
  };
}

export const resultLimitForContext=(contextWindow?:number|null)=>runtimeLimits(contextWindow).resultChars;
export const searchPageForContext=(contextWindow?:number|null)=>runtimeLimits(contextWindow).searchPage;

/** Context window reported in an SDK result message (modelUsage[*].contextWindow), if any. */
export function reportedContextWindow(message:any):number|undefined {
  const usage=message?.modelUsage;
  if(!usage||typeof usage!=='object')return undefined;
  const windows=Object.values(usage).map((entry:any)=>entry?.contextWindow).filter((value:any)=>typeof value==='number'&&value>0) as number[];
  return windows.length?Math.max(...windows):undefined;
}

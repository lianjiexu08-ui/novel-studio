import { isDeepStrictEqual } from 'node:util';
import type { UnresolvedQuestion } from './world.ts';

export class DesignQuestionConflictError extends Error {}

/** Generation may append questions, but cannot erase or adjudicate the retained
 * ledger. Deliberate author revisions use the separate save/review workflow. */
export function retainDesignQuestions(previous: UnresolvedQuestion[] = [], generated: UnresolvedQuestion[] = []): UnresolvedQuestion[] {
  const checked = (questions: UnresolvedQuestion[]) => {
    const entries = new Map<string, UnresolvedQuestion>();
    for (const question of questions) {
      if (entries.has(question.id)) throw new DesignQuestionConflictError(`设计问题编号重复：${question.id}；不能静默覆盖记录`);
      entries.set(question.id, question);
    }
    return entries;
  };
  const retained = checked(previous), incoming = checked(generated);
  for (const [id, question] of incoming) {
    if (retained.has(id) && !isDeepStrictEqual(retained.get(id), question)) {
      throw new DesignQuestionConflictError(`生成结果改写了已有设计问题 ${id}；问题原文、blocking 和 status 须保留，处理结论请走明确的设计修订与评审`);
    }
  }
  return structuredClone([...previous, ...generated.filter(question => !retained.has(question.id))]);
}

import { ChapterWorkflow, type WorkRepository } from '../src/index.ts';
import { createReadyWork, fixtureDesignReview } from './fixtures.ts';
import { designReviewCheckHash } from '../../../novel-service-core/src/design-review-annotations.ts';
import type { AddDesignReviewAnnotation } from 'novel-studio-contracts';

export const annotationWriter = { generateChapter: () => ({ content: 'unused', proposedEvents: [] }) };
export async function annotationFixture(repository: WorkRepository) {
  const workflow = new ChapterWorkflow(repository, annotationWriter, {
    generateWorldPack: async () => { throw Error('unused'); },
    generateStoryBible: async () => { throw Error('unused'); },
    reviewDesignContent: async input => {
      const result = fixtureDesignReview(input);
      result.checks[0] = { ...result.checks[0], verdict: 'revise', explanation: '评语误称力量没有代价，需要修改。', revisionAdvice: '补充力量代价。' };
      return result;
    },
  });
  const work = await createReadyWork(workflow, '核对记录测试');
  let run = await workflow.startDesignReview(work.id, 'world');
  while (run.status !== 'completed') run = await workflow.stepDesignReview(work.id, run.id);
  const stage = run.stages.find(stage => stage.result)!;
  const check = stage.result!.checks[0];
  const input: AddDesignReviewAnnotation = {
    requestKey: 'cost-reading-1', runId: run.id, stageId: stage.id, criterion: check.criterion,
    expectedInputHash: run.input.inputHash, expectedCheckHash: designReviewCheckHash(check),
    claimQuote: '评语误称力量没有代价', explanation: '原始设定已明确代价；这条说明不替代原判定。',
    evidence: [{ sourceId: 'world/axioms/axiom', quote: '力量必须支付代价' }],
  };
  return { workflow, workId: work.id, run, input };
}

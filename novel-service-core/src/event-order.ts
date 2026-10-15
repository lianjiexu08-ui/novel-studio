import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { EventDraft, StoryEvent, Work } from './core.ts';

function fact(event: EventDraft) {
  return [event.eventType, event.subjectId, event.predicate, event.value, event.storyTime, event.evidence ?? ''];
}

// These projections track a subject's last status regardless of predicate.
const subjectStates = new Set(['relationship_change', 'arc_progress', 'secret_reveal', 'promise_payoff', 'thread_resolution', 'volume_progress', 'plot_progress']);
function stateKey(event: EventDraft): string {
  return JSON.stringify([event.eventType, event.subjectId, subjectStates.has(event.eventType) ? '' : event.predicate]);
}

/** Independent extraction must agree on each state transition sequence, including
 * repeated occurrences. Unrelated subjects may be reported in a different order. */
export function eventChangesAgree(proposed: EventDraft[], observed: EventDraft[]): boolean {
  const sequences = (events: EventDraft[]) => {
    const groups = new Map<string, unknown[]>();
    for (const event of events) {
      const key = stateKey(event);
      const values = groups.get(key) ?? [];
      values.push([event.predicate, event.value]);
      groups.set(key, values);
    }
    return groups;
  };
  return isDeepStrictEqual(sequences(proposed), sequences(observed));
}

/** Recover adoption order from the retained candidate, never from a random event ID.
 * IDs only break ties between indistinguishable duplicate occurrences, or provide
 * a stable display order for legacy records whose chronology is unavailable.
 * Callers must not use that legacy fallback to certify conflicting final states.
 * No stored event, candidate, or historical report is modified.
 */
export function resolveStoryEventOrder(work: Work, input: Iterable<StoryEvent> = work.events.values()): { events: StoryEvent[]; issues: string[] } {
  const selected = [...input].filter(event => event.workId === work.id);
  const wanted = new Set(selected.map(event => event.chapterVersionId));
  const groups = new Map<string, StoryEvent[]>();
  for (const event of work.events.values()) {
    if (event.workId !== work.id || !wanted.has(event.chapterVersionId)) continue;
    const group = groups.get(event.chapterVersionId) ?? [];
    group.push(event);
    groups.set(event.chapterVersionId, group);
  }
  const positions = new Map<string, number>();
  const verified = new Set<string>();
  const issues: string[] = [];
  for (const [versionId, records] of groups) {
    const version = work.versions.get(versionId);
    const candidate = version?.sourceCandidateId ? work.candidates.get(version.sourceCandidateId) : undefined;
    const bound = version && candidate && version.workId === work.id && candidate.workId === work.id
      && candidate.chapterNumber === version.chapterNumber && candidate.adoptedVersionId === version.id
      && candidate.status === 'adopted' && candidate.content === version.content
      && candidate.contentHash === createHash('sha256').update(version.content).digest('hex')
      && records.every(event => event.chapterNumber === version.chapterNumber)
      && records.length === candidate.proposedEvents.length;
    if (bound) {
      const remaining = [...records].sort((a, b) => a.id.localeCompare(b.id));
      const matched: Array<[string, number]> = [];
      for (const [index, draft] of candidate.proposedEvents.entries()) {
        const found = remaining.findIndex(event => isDeepStrictEqual(fact(event), fact(draft)));
        if (found < 0) break;
        matched.push([remaining.splice(found, 1)[0].id, index]);
      }
      if (matched.length === records.length) {
        matched.forEach(([eventId, index]) => positions.set(eventId, index));
        verified.add(versionId);
        continue;
      }
    }
    if (version?.sourceCandidateId) issues.push(`第 ${version.chapterNumber} 章 ${versionId}：章节来源与采纳候选稿的事件顺序依据不完整或不一致，需复核。`);
  }
  const fields = new Map<string, StoryEvent[]>();
  for (const event of selected) {
    const key = JSON.stringify([event.chapterNumber, stateKey(event)]);
    const field = fields.get(key) ?? [];
    field.push(event);
    fields.set(key, field);
  }
  for (const records of fields.values()) {
    const first = records[0];
    if (!records.some(event => !isDeepStrictEqual(event.value, first.value))) continue;
    if (records.every(event => event.chapterVersionId === first.chapterVersionId && verified.has(event.chapterVersionId))) continue;
    issues.push(`第 ${first.chapterNumber} 章 ${first.eventType}/${first.subjectId}/${first.predicate}：同章多次变化缺少可验证顺序，章末状态待确认。`);
  }
  const events = selected.sort((a, b) => a.chapterNumber - b.chapterNumber
    || a.chapterVersionId.localeCompare(b.chapterVersionId)
    || (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0)
    || a.id.localeCompare(b.id));
  return { events, issues };
}

/** Ordered facts; inspect resolveStoryEventOrder().issues before certifying them. */
export function orderedStoryEvents(work: Work, input: Iterable<StoryEvent> = work.events.values()): StoryEvent[] {
  return resolveStoryEventOrder(work, input).events;
}

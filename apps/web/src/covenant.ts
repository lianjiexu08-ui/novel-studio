import type { CreativeCovenant } from 'novel-studio-contracts';

export const COVENANT_DEFAULTS = {
  substyle: '',
  audience: '',
  hook: '',
  protagonistGoal: '',
  obstacle: '',
  readingExperience: '',
  mustKeep: '',
  lockedNotes: '',
  avoid: '',
  targetLength: '长篇，篇幅未定',
  chapterWords: 2200,
  updateCadence: '日更',
};

export interface CovenantFormValues {
  title: string;
  substyle: string;
  audience: string;
  hook: string;
  protagonistGoal: string;
  obstacle: string;
  readingExperience: string;
  mustKeep: string;
  lockedNotes: string;
  avoid: string;
  targetLength: string;
  targetChapterCount?: number | null;
  volumeCount?: number | null;
  chapterWords: number;
  updateCadence: string;
  /** The author's own words for this revision; kept verbatim next to the structured covenant. */
  authorText?: string;
}

export function covenantReady(covenant?: Pick<CreativeCovenant, 'audience' | 'hook'>): boolean {
  return Boolean(covenant?.audience.trim() && covenant.hook.trim());
}

export function toCovenant(values: CovenantFormValues): CreativeCovenant {
  return {
    entryMode: 'expand',
    genre: 'xuanhuan',
    substyle: values.substyle.trim(),
    audience: values.audience.trim(),
    hook: values.hook.trim(),
    protagonistGoal: (values.protagonistGoal ?? '').trim(),
    obstacle: (values.obstacle ?? '').trim(),
    readingExperience: (values.readingExperience ?? '').trim(),
    mustKeep: values.mustKeep.trim(),
    lockedNotes: values.lockedNotes.trim(),
    avoid: values.avoid.trim(),
    targetLength: values.targetLength.trim() || COVENANT_DEFAULTS.targetLength,
    targetChapterCount: values.targetChapterCount ?? undefined,
    volumeCount: values.volumeCount ?? undefined,
    chapterWords: values.chapterWords,
    updateCadence: values.updateCadence.trim() || COVENANT_DEFAULTS.updateCadence,
  };
}

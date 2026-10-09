import type { CreativeCovenant } from 'novel-studio-contracts';

export const COVENANT_DEFAULTS = {
  substyle: '',
  audience: '',
  hook: '',
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
  mustKeep: string;
  lockedNotes: string;
  avoid: string;
  targetLength: string;
  chapterWords: number;
  updateCadence: string;
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
    mustKeep: values.mustKeep.trim(),
    lockedNotes: values.lockedNotes.trim(),
    avoid: values.avoid.trim(),
    targetLength: values.targetLength.trim() || COVENANT_DEFAULTS.targetLength,
    chapterWords: values.chapterWords,
    updateCadence: values.updateCadence.trim() || COVENANT_DEFAULTS.updateCadence,
  };
}

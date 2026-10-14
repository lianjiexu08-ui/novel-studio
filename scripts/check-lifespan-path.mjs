import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Offline candidate audit only. Passing arithmetic never approves a design or a plan.
// The resource policy must itself be checked against the world text by a reviewer.
export function checkLifespanPath(path, policy) {
  const issues = [];
  const fail = (step, message) => issues.push({ step, message });
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  if (!path || !policy || !Array.isArray(path.steps) || !path.steps.length
      || !finite(path.startingDay) || !finite(path.startingLife)
      || !Number.isInteger(path.startingRealm) || path.startingRealm < 1 || path.startingRealm > 7
      || !finite(path.safetyReserve) || path.safetyReserve <= 0) {
    return { valid: false, issues: [{ step: null, message: 'Missing or invalid starting state, reserve, policy or steps.' }] };
  }
  let day = path.startingDay, life = path.startingLife, realm = path.startingRealm;
  const doses = { ...path.initialDoses }, lastCourses = {}, perCycle = {};
  // Historical doses have no assumed cooldown completion time.
  for (const [id, count] of Object.entries(doses)) {
    if (!Number.isInteger(count) || count < 0) fail(null, `${id}: invalid historical dose count.`);
  }
  if (life < path.safetyReserve) fail(null, 'Starting life is below the reserve.');
  const rows = [];
  for (const [index, step] of path.steps.entries()) {
    const required = ['day', 'income', 'doses', 'naturalElapsedDays', 'advancementDebit', 'spellDebit', 'closingLife'];
    if (!step || required.some((key) => !finite(step[key]))) {
      fail(index, 'Missing or non-finite accounting values.');
      continue;
    }
    if (step.day < day || step.naturalElapsedDays !== step.day - day) fail(index, 'Day order or natural elapsed days disagree.');
    if ([step.income, step.doses, step.advancementDebit, step.spellDebit].some((v) => v < 0)) fail(index, 'Negative income, dose count or debit.');
    if (step.realmBefore !== realm) fail(index, 'Realm before action disagrees with prior state.');
    const before = life - (step.day - day) / 365;
    if (before < path.safetyReserve) fail(index, 'Cannot survive the wait with the required reserve before income.');
    if (step.incomeResourceId !== null) {
      const id = step.incomeResourceId, rule = policy[id];
      const fields = ['income', 'lifetimeDoses', 'minimumRealm', 'courseDays', 'firstMaturityDay', 'cycleDays', 'maxHarvest', 'reservedHarvest', 'maxPerPersonPerCycle', 'minGapDays', 'everyTwoGapDays', 'maxStartDelayDays'];
      if (!rule || fields.some((key) => !finite(rule[key])) || rule.cycleDays <= 0 || rule.courseDays <= 0
          || rule.income <= 0 || rule.maxHarvest < rule.reservedHarvest) {
        fail(index, `${id}: missing or invalid resource policy.`);
      } else {
        if (step.doses !== 1 || Math.abs(step.income - rule.income) > 1e-6) fail(index, `${id}: record one completed course at a time at the defined dose yield.`);
        const count = doses[id] ?? 0;
        if (count + step.doses > rule.lifetimeDoses) fail(index, `${id}: lifetime dose limit exceeded.`);
        if (realm < rule.minimumRealm) fail(index, `${id}: insufficient realm for treatment.`);
        if (!finite(step.courseStartDay) || !finite(step.harvestDay)
            || step.courseStartDay < day || step.day - step.courseStartDay !== rule.courseDays
            || step.courseStartDay < step.harvestDay
            || step.courseStartDay - step.harvestDay > rule.maxStartDelayDays) {
          fail(index, `${id}: treatment, harvest or receipt timing is invalid.`);
        }
        const cycle = (step.harvestDay - rule.firstMaturityDay) / rule.cycleDays;
        if (!Number.isInteger(cycle) || cycle < 0) fail(index, `${id}: harvest is not in a defined maturity window.`);
        const cycleKey = `${id}/${cycle}`;
        perCycle[cycleKey] = (perCycle[cycleKey] ?? 0) + step.doses;
        if (perCycle[cycleKey] > Math.min(rule.maxPerPersonPerCycle, rule.maxHarvest - rule.reservedHarvest)) fail(index, `${id}: personal or available cycle quota exceeded.`);
        const previousEnd = lastCourses[id] ?? path.priorCourseEnds?.[id];
        if (count > 0 && !finite(previousEnd)) fail(index, `${id}: last historical treatment date is required to check its interval.`);
        const gap = count > 0 && count % 2 === 0 ? Math.max(rule.minGapDays, rule.everyTwoGapDays) : rule.minGapDays;
        if (finite(previousEnd) && step.courseStartDay - previousEnd < gap) fail(index, `${id}: medical interval is too short.`);
        doses[id] = count + step.doses;
        lastCourses[id] = step.day;
      }
    } else if (step.income !== 0 || step.doses !== 0) {
      fail(index, 'Income or doses without a resource.');
    }
    if (step.realmAfter !== realm) {
      const entryCost = { 2: 3, 3: 10, 4: 30, 5: 60, 6: 100, 7: 200 }[step.realmAfter];
      if (step.realmAfter !== realm + 1 || entryCost === undefined || step.advancementDebit !== entryCost) fail(index, 'Skipped realm or wrong advancement cost.');
    } else if (step.advancementDebit !== 0) fail(index, 'Advancement charged without a realm change.');
    if (step.spellDebit > 0 && !(realm === 7 && ((step.techniqueId === 'tech_15' && step.spellDebit === 100) || (step.techniqueId === 'tech_16' && step.spellDebit === 300)))) {
      fail(index, 'This audit only defines the 100/300 life costs for qualified realm 7 spell examples.');
    }
    life = before + step.income - step.advancementDebit - step.spellDebit;
    if (Math.abs(life - step.closingLife) > 1e-6) fail(index, 'Declared closing balance disagrees with independent arithmetic.');
    if (life < path.safetyReserve) fail(index, 'Closing life is below the required reserve.');
    rows.push({ day: step.day, beforeIncome: before, closingLife: life });
    day = step.day;
    realm = step.realmAfter;
  }
  return { valid: issues.length === 0, issues, rows, doses, finalLife: life, finalRealm: realm,
    limitation: 'Arithmetic and declared resource policy only; not medical, political, narrative or formal acceptance.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const proposal = input.proposal ?? input;
  if (!Array.isArray(proposal.conditionalBudgets) || !proposal.conditionalBudgets.length) throw new Error('No conditional paths provided.');
  const results = proposal.conditionalBudgets.map((path) => checkLifespanPath(path, proposal.budgetPolicy));
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.valid)) process.exitCode = 1;
}

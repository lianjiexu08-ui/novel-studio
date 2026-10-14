import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLifespanPath } from './check-lifespan-path.mjs';

const policy = { herb: { income: 60, lifetimeDoses: 2, minimumRealm: 3, courseDays: 30, firstMaturityDay: 900, cycleDays: 2920, maxHarvest: 2, reservedHarvest: 1, maxPerPersonPerCycle: 1, minGapDays: 365, everyTwoGapDays: 1095, maxStartDelayDays: 7 } };
function fixture() {
  return { startingDay: 466, startingLife: 3, startingRealm: 3, safetyReserve: 1, steps: [
    { day: 930, realmBefore: 3, realmAfter: 3, incomeResourceId: 'herb', income: 60, doses: 1, naturalElapsedDays: 464, courseStartDay: 900, harvestDay: 900, advancementDebit: 0, spellDebit: 0, closingLife: 63 - 464 / 365 },
    { day: 1000, realmBefore: 3, realmAfter: 4, incomeResourceId: null, income: 0, doses: 0, naturalElapsedDays: 70, advancementDebit: 30, spellDebit: 0, closingLife: 33 - 534 / 365 },
  ] };
}
test('finite source completes before the next realm is paid, without changing the input', () => {
  const path = fixture(), before = structuredClone(path), result = checkLifespanPath(path, policy);
  assert.equal(result.valid, true); assert.deepEqual(path, before); assert.equal(result.finalRealm, 4);
});
test('rejects spending future income after the person would run out during the wait', () => {
  const p = fixture(); p.startingLife = 1.1;
  assert.match(JSON.stringify(checkLifespanPath(p, policy).issues), /Cannot survive/);
});
test('rejects duplicate lifetime doses and requires historical treatment dates', () => {
  const p = fixture(); p.initialDoses = { herb: 2 };
  const result = checkLifespanPath(p, policy);
  assert.match(JSON.stringify(result.issues), /lifetime dose limit/);
  assert.match(JSON.stringify(result.issues), /historical treatment date/);
});
test('rejects circular eligibility, immature harvest and shortened therapy', () => {
  const p = fixture(); p.startingRealm = 2; p.steps[0].realmBefore = 2;
  p.steps[0].harvestDay = 901; p.steps[0].courseStartDay = 905;
  const issues = JSON.stringify(checkLifespanPath(p, policy).issues);
  assert.match(issues, /insufficient realm/); assert.match(issues, /maturity window/); assert.match(issues, /timing is invalid/);
});
test('rejects false arithmetic, missing costs and negative breakthrough balance', () => {
  const p = fixture(); p.steps[1].closingLife = -10; p.steps[1].advancementDebit = 100;
  const issues = JSON.stringify(checkLifespanPath(p, policy).issues);
  assert.match(issues, /wrong advancement cost/); assert.match(issues, /independent arithmetic/); assert.match(issues, /below the required reserve/);
});
test('enforces long pauses after two doses, not just the ordinary interval', () => {
  const p = fixture(); p.initialDoses = { herb: 2 }; p.priorCourseEnds = { herb: 0 };
  const rules = structuredClone(policy); rules.herb.lifetimeDoses = 6;
  assert.match(JSON.stringify(checkLifespanPath(p, rules).issues), /medical interval/);
});
test('missing, non-finite or empty accounting cannot receive a pass', () => {
  const p = fixture(); p.steps[0].income = NaN;
  assert.equal(checkLifespanPath(p, policy).valid, false);
  assert.equal(checkLifespanPath({ ...fixture(), steps: [] }, policy).valid, false);
  assert.equal(checkLifespanPath(fixture(), {}).valid, false);
});

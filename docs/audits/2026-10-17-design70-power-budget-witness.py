"""Independent exact arithmetic for the saved proposal's conditional lifespan example.

No model, database, or review-state writes. This checks a conditional numerical
witness, not whether its competitive allocations or story events will occur.
"""
import hashlib
import json
import re
import sys
from fractions import Fraction
from pathlib import Path

root = Path(__file__).resolve().parents[2]
control = root / "data/audit-runtimes/design70-review"
input_bytes = (control / "inputs.json").read_bytes()
baseline = json.loads((control / "baseline.json").read_bytes())
assert hashlib.sha256(input_bytes).hexdigest() == baseline["inputsSha256"]
inputs = json.loads(input_bytes)["power"]
sources = {s["id"]: s["text"] for s in inputs["sources"]}
used = set()


def source(key):
    used.add(key)
    return json.loads(sources[key])


def has(key, *quotes):
    text = json.dumps(source(key), ensure_ascii=False)
    for quote in quotes:
        assert quote in text, (key, quote)


# These rule values are bound to verbatim excerpts from the inspected sources.
# A changed rule fails rather than silently reusing this audit's interpretation.
rules = {
    "res_17": dict(first=540, cycle=548, gain=8, days=14, max_doses=10,
                   gap=30, pair_gap=90, start_limit=2, storage=21, last_dose=6, min_rank=2),
    "res_18": dict(first=900, cycle=2920, gain=60, days=30, max_doses=6,
                   gap=365, pair_gap=1095, start_limit=7, storage=40, last_dose=28, min_rank=3),
    "res_19": dict(first=2010, cycle=2190, gain=120, days=45, max_doses=8,
                   gap=1825, pair_gap=3650, start_limit=12, storage=60, last_dose=45, min_rank=4),
}
has("world/resources/res_17", "至少凝元境三重", "十四整日", "新增八元载", "终生十枚",
    "至少三十日", "至少九十日", "548个自然日", "第540日", "每人每期至多一枚",
    "破袋后四十八小时内须开始疗程", "最后服药必须在采后21日内")
has("world/resources/res_18", "至少玄府境", "第0、7、14、21、28日", "第30日复诊",
    "六十元载", "终生六段", "至少365日", "至少1095日", "2920个自然日", "第900日",
    "每人每窗口至多一段", "采后七日内必须开始疗程", "总保存上限四十日")
has("world/resources/res_19", "至少神海境", "四十五日", "一百二十元载", "终生八匣",
    "至少1825日", "至少3650日", "2190个自然日", "第2010日", "每人每窗口至多一匣",
    "采后十二日内开始疗程", "保存上限六十日", "所有成功新增合计上限1430元载")
has("world/techniques/tech_15", "百元载", "三年道伤期", "法力上限三成", "神识上限二成", "百分之一")
has("world/techniques/tech_16", "三百元载", "法力五成", "神识三成", "百分之一", "三十日内不得再发动")
has("world/realms/realm_08", "本命神魂本源上限的一成", "至少保留同一基准二成")
advancement = [("realm_04", 30, "三十年"), ("realm_05", 60, "六十年"),
               ("realm_06", 100, "百年"), ("realm_07", 200, "两百年")]
for realm, _, quote in advancement:
    has("world/realms/" + realm, "损耗寿元" + quote)

witness = source("world/axioms/ax_11")["content"]
has("world/axioms/ax_04", "一元载按365日当量记账", "诊断校正不是寿元收入")
has("world/axioms/ax_11", "起算第466日", "第19日诊断7元载", "历史两剂灵泉10",
    "凝元3、玄府10", "扣447/365自然流逝", "不能复制算例给整支军团", "示例只证明寿储可付", "共848元载")
lines = [line for line in witness.splitlines() if re.match(r"第\d+日：", line)]
assert len(lines) == 17
balance = Fraction(7 - 3 + 10 - 10) - Fraction(466 - 19, 365)
day, rank, next_advancement = 466, 3, 0
courses, rows, casts = [], [], []
for line in lines:
    match = re.fullmatch(r"第(\d+)日：距上笔(\d+)日，(.+?)，扣自然流逝后余(\d+\.\d+)元载(?:，采收(\d+)日、疗程(\d+)至(\d+)日)?。", line)
    assert match, line
    new_day, elapsed = int(match[1]), int(match[2])
    assert new_day - day == elapsed and elapsed > 0
    before = balance - Fraction(elapsed, 365)
    assert before >= 1, "Lifespan falls below safety floor before the next event"
    action, gain, spend = match[3], 0, 0
    income = re.fullmatch(r"(res_\d+)一剂入账(\d+)，无晋阶或燃寿支出", action)
    if income:
        resource, gain = income[1], int(income[2])
        rule = rules[resource]
        harvest, start, end = map(int, match.group(5, 6, 7))
        assert gain == rule["gain"] and rank >= rule["min_rank"]
        assert harvest >= rule["first"] and (harvest - rule["first"]) % rule["cycle"] == 0
        assert end == new_day and end - start == rule["days"]
        assert 0 <= start - harvest <= rule["start_limit"]
        assert start + rule["last_dose"] - harvest <= rule["storage"]
        own = [course for course in courses if course["resource"] == resource]
        assert len(own) < rule["max_doses"]
        assert all(course["harvest"] != harvest for course in own)
        if own:
            minimum_gap = rule["pair_gap"] if len(own) % 2 == 0 else rule["gap"]
            assert start - own[-1]["end"] >= minimum_gap
        assert all(start >= course["end"] for course in courses), "Overlapping treatments"
        courses.append(dict(resource=resource, harvest=harvest, start=start, end=end, gain=gain, rank=rank))
    else:
        payment = re.fullmatch(r"无寿源收入，(晋阶|tech_\d+)付(\d+)", action)
        assert payment and match[5] is None
        spend = int(payment[2])
        if payment[1] == "晋阶":
            realm, expected, _ = advancement[next_advancement]
            assert spend == expected
            next_advancement += 1
            rank += 1
            assert source("world/realms/" + realm)["rank"] == rank
        else:
            technique = source("world/techniques/" + payment[1])
            assert "realm_" + str(rank).zfill(2) in technique["allowedRealmIds"]
            assert spend == {"tech_15": 100, "tech_16": 300}[payment[1]]
            casts.append(dict(technique=payment[1], day=new_day, rank=rank, lifespanCost=spend))
    balance = before + gain - spend
    assert balance >= 1
    assert abs(balance - Fraction(match[4])) <= Fraction(1, 1_000_000), line
    rows.append(dict(day=new_day, elapsed=elapsed, income=gain, expense=spend,
                     balanceNumerator=balance.numerator, balanceDenominator=balance.denominator,
                     balanceRounded=f"{float(balance):.6f}", statedBalance=match[4]))
    day = new_day
assert next_advancement == 4 and rank == 7  # This witness does not establish a sovereign ascension.
assert sum(course["gain"] for course in courses) == 848
assert {key: sum(c["resource"] == key for c in courses) for key in rules} == {"res_17": 1, "res_18": 6, "res_19": 4}
assert casts[1]["day"] - casts[0]["day"] > 3 * 365
assert 6 * 5 + 10 * 8 + 6 * 60 + 8 * 120 == 1430
proof = dict(kind="design70_conditional_lifespan_witness", inputHash=inputs["inputHash"],
             inputFileSha256=hashlib.sha256(input_bytes).hexdigest(),
             sourceSha256={key: hashlib.sha256(sources[key].encode()).hexdigest() for key in sorted(used)},
             rows=rows, courses=courses, casts=casts, finalRealmRank=rank,
             checks=["all 17 exact ledger balances", "pre-event and post-event safety floor",
                     "maturity windows and one dose per window", "minimum patient realm",
                     "course duration, storage and start deadlines", "no overlapping courses",
                     "per-resource lifetime caps and post-pair waiting periods", "defined advancement and spell lifespan costs"],
             modelCalls=0, productionWrites=0, formalAcceptance=False,
             limitation="Conditional arithmetic and listed timing/realm constraints only. Does not establish allocation wins, exact payments, equipment, staff, training, health, source repair, full spell usability, protagonist entitlements or future prose execution.")
output = root / "docs/audits/2026-10-17-design70-power-budget-witness.json"
if sys.argv[1:] == ["--verify"]:
    assert json.loads(output.read_bytes()) == proof
else:
    assert not sys.argv[1:], "Use --verify to compare the existing immutable proof"
    with output.open("x") as handle:
        json.dump(proof, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
print(json.dumps(dict(verifiedRows=len(rows), verifiedCourses=len(courses), lifespanIncome=848,
                     finalBalance=rows[-1]["balanceRounded"], finalRealmRank=rank,
                     modelCalls=0, formalAcceptance=False)))

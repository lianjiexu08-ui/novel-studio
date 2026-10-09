"""Small, deterministic domain core for the long-form novel service.

The module intentionally has no web framework, database, queue, or real model
SDK dependency.  ``Work`` is an in-memory aggregate that can later be backed
by PostgreSQL.  The important rules live here so an API and a worker cannot
accidentally implement different adoption semantics.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import hashlib
import uuid
from typing import Any, Dict, Iterable, List, Optional, Protocol, Tuple


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CheckStatus(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    INCONCLUSIVE = "inconclusive"
    UNAVAILABLE = "unavailable"


class CandidateStatus(str, Enum):
    CANDIDATE = "candidate"
    ADOPTED = "adopted"
    REJECTED = "rejected"


class VersionStatus(str, Enum):
    ADOPTED = "adopted"
    SUPERSEDED = "superseded"


class AdoptionBlocked(RuntimeError):
    """Raised when the quality gate has not passed."""


class SimulatedCrash(RuntimeError):
    """Used by tests to model a worker dying between checkpoints."""


@dataclass(frozen=True)
class EventDraft:
    """A model-proposed state change; it is not canonical until adoption."""

    event_type: str
    subject_id: str
    predicate: str
    value: Any
    story_time: Optional[int] = None
    evidence: str = ""


@dataclass
class StoryEvent:
    id: str
    work_id: str
    chapter_version_id: str
    chapter_number: int
    event_type: str
    subject_id: str
    predicate: str
    value: Any
    story_time: Optional[int]
    evidence: str
    active: bool = True


@dataclass
class CharacterState:
    character_id: str
    field: str
    value: Any
    source_event_id: str
    source_chapter_version_id: str
    story_time: Optional[int]


@dataclass
class CheckResult:
    checker: str
    status: CheckStatus
    message: str = ""
    checked_candidate_id: str = ""
    checked_at: str = field(default_factory=_now)


@dataclass
class ChapterCandidate:
    id: str
    work_id: str
    chapter_number: int
    content: str
    proposed_events: List[EventDraft]
    run_id: str
    status: CandidateStatus = CandidateStatus.CANDIDATE
    checks: List[CheckResult] = field(default_factory=list)
    adopted_version_id: Optional[str] = None
    created_at: str = field(default_factory=_now)


@dataclass
class ChapterVersion:
    id: str
    work_id: str
    chapter_number: int
    revision: int
    content: str
    status: VersionStatus
    parent_version_id: Optional[str]
    source_candidate_id: Optional[str]
    stale: bool = False
    affected_by: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=_now)


@dataclass
class ImpactRecord:
    id: str
    work_id: str
    changed_chapter_number: int
    affected_chapter_numbers: List[int]
    reason: str
    created_at: str = field(default_factory=_now)


@dataclass
class Checkpoint:
    run_id: str
    work_id: str
    target_chapter: int
    next_chapter: int = 1
    phase: str = "idle"  # idle, generated, checked, adopted, complete
    candidate_ids: Dict[int, str] = field(default_factory=dict)
    updated_at: str = field(default_factory=_now)


@dataclass
class GeneratedChapter:
    content: str
    events: List[EventDraft]


class ModelProvider(Protocol):
    def generate_chapter(
        self, *, work: "Work", chapter_number: int, context: Dict[str, Any]
    ) -> GeneratedChapter:
        ...


class CandidateChecker(Protocol):
    name: str

    def check(self, *, work: "Work", candidate: ChapterCandidate) -> CheckResult:
        ...


class DeterministicFakeProvider:
    """A predictable provider used for integration tests and local spikes."""

    def generate_chapter(
        self, *, work: "Work", chapter_number: int, context: Dict[str, Any]
    ) -> GeneratedChapter:
        previous = context.get("last_power", 0)
        power = int(previous) + 1
        content = (
            f"Chapter {chapter_number}: {work.title}. "
            f"Hero advances from {previous} to {power}."
        )
        event = EventDraft(
            event_type="character_state",
            subject_id="hero",
            predicate="power",
            value=power,
            story_time=chapter_number,
            evidence=f"Hero advances from {previous} to {power}.",
        )
        return GeneratedChapter(content=content, events=[event])


class PassChecker:
    name = "deterministic_rules"

    def check(self, *, work: "Work", candidate: ChapterCandidate) -> CheckResult:
        if not candidate.content.strip():
            return CheckResult(self.name, CheckStatus.FAILED, "empty chapter", candidate.id)
        return CheckResult(self.name, CheckStatus.PASSED, "ok", candidate.id)


class UnavailableChecker:
    name = "semantic_checker"

    def check(self, *, work: "Work", candidate: ChapterCandidate) -> CheckResult:
        return CheckResult(
            self.name,
            CheckStatus.UNAVAILABLE,
            "checker service is unavailable",
            candidate.id,
        )


class FailingChecker:
    name = "failing_checker"

    def check(self, *, work: "Work", candidate: ChapterCandidate) -> CheckResult:
        return CheckResult(self.name, CheckStatus.FAILED, "deliberate failure", candidate.id)


@dataclass
class Work:
    id: str
    title: str
    candidates: Dict[str, ChapterCandidate] = field(default_factory=dict)
    versions: Dict[str, ChapterVersion] = field(default_factory=dict)
    versions_by_chapter: Dict[int, List[str]] = field(default_factory=dict)
    events: Dict[str, StoryEvent] = field(default_factory=dict)
    states: Dict[Tuple[str, str], CharacterState] = field(default_factory=dict)
    checkpoints: Dict[str, Checkpoint] = field(default_factory=dict)
    impacts: List[ImpactRecord] = field(default_factory=list)

    def current_version(self, chapter_number: int) -> Optional[ChapterVersion]:
        ids = self.versions_by_chapter.get(chapter_number, [])
        adopted = [self.versions[i] for i in ids if self.versions[i].status == VersionStatus.ADOPTED]
        return adopted[-1] if adopted else None

    def adopted_versions(self) -> List[ChapterVersion]:
        return sorted(
            [v for v in self.versions.values() if v.status == VersionStatus.ADOPTED],
            key=lambda v: (v.chapter_number, v.revision),
        )


class NovelService:
    """Application service enforcing candidate/adoption and checkpoint rules."""

    def __init__(self, provider: ModelProvider):
        self.provider = provider
        self.works: Dict[str, Work] = {}

    def create_work(self, title: str) -> Work:
        work = Work(id=_id("work"), title=title)
        self.works[work.id] = work
        return work

    def context_for(self, work: Work, chapter_number: int) -> Dict[str, Any]:
        prior = [
            e
            for e in work.events.values()
            if e.active and e.chapter_number < chapter_number
        ]
        power = 0
        for event in sorted(prior, key=lambda e: e.chapter_number):
            if event.subject_id == "hero" and event.predicate == "power":
                power = int(event.value)
        return {"last_power": power, "active_event_count": len(prior)}

    def generate_candidate(
        self, work_id: str, chapter_number: int, *, run_id: Optional[str] = None
    ) -> ChapterCandidate:
        work = self.works[work_id]
        run_id = run_id or _id("run")
        # Generation is idempotent for a run/chapter pair.
        for candidate in work.candidates.values():
            if candidate.run_id == run_id and candidate.chapter_number == chapter_number:
                return candidate
        generated = self.provider.generate_chapter(
            work=work,
            chapter_number=chapter_number,
            context=self.context_for(work, chapter_number),
        )
        candidate = ChapterCandidate(
            id=_id("candidate"),
            work_id=work.id,
            chapter_number=chapter_number,
            content=generated.content,
            proposed_events=list(generated.events),
            run_id=run_id,
        )
        work.candidates[candidate.id] = candidate
        return candidate

    def run_checks(
        self, work_id: str, candidate_id: str, checkers: Iterable[CandidateChecker]
    ) -> List[CheckResult]:
        work = self.works[work_id]
        candidate = work.candidates[candidate_id]
        # Re-running replaces checks from the same checker names and is safe.
        existing = {result.checker: result for result in candidate.checks}
        for checker in checkers:
            existing[checker.name] = checker.check(work=work, candidate=candidate)
        candidate.checks = list(existing.values())
        return candidate.checks

    @staticmethod
    def _quality_gate(candidate: ChapterCandidate) -> None:
        if not candidate.checks:
            raise AdoptionBlocked("no quality checks have completed")
        blocked = [r for r in candidate.checks if r.status != CheckStatus.PASSED]
        if blocked:
            details = ", ".join(f"{r.checker}:{r.status.value}" for r in blocked)
            raise AdoptionBlocked(f"quality gate blocked ({details})")

    def adopt_candidate(self, work_id: str, candidate_id: str) -> ChapterVersion:
        work = self.works[work_id]
        candidate = work.candidates[candidate_id]
        if candidate.status == CandidateStatus.ADOPTED:
            assert candidate.adopted_version_id is not None
            return work.versions[candidate.adopted_version_id]
        self._quality_gate(candidate)

        # Aggregate snapshot gives the in-memory spike transaction semantics.
        snapshot = deepcopy(work)
        try:
            prior = work.current_version(candidate.chapter_number)
            revision = (prior.revision + 1) if prior else 1
            if prior:
                prior.status = VersionStatus.SUPERSEDED
                for event in work.events.values():
                    if event.chapter_version_id == prior.id:
                        event.active = False
            version = ChapterVersion(
                id=_id("version"),
                work_id=work.id,
                chapter_number=candidate.chapter_number,
                revision=revision,
                content=candidate.content,
                status=VersionStatus.ADOPTED,
                parent_version_id=prior.id if prior else None,
                source_candidate_id=candidate.id,
            )
            work.versions[version.id] = version
            work.versions_by_chapter.setdefault(version.chapter_number, []).append(version.id)
            for draft in candidate.proposed_events:
                event = StoryEvent(
                    id=_id("event"),
                    work_id=work.id,
                    chapter_version_id=version.id,
                    chapter_number=version.chapter_number,
                    event_type=draft.event_type,
                    subject_id=draft.subject_id,
                    predicate=draft.predicate,
                    value=draft.value,
                    story_time=draft.story_time,
                    evidence=draft.evidence,
                )
                work.events[event.id] = event
                if event.event_type == "character_state":
                    work.states[(event.subject_id, event.predicate)] = CharacterState(
                        character_id=event.subject_id,
                        field=event.predicate,
                        value=event.value,
                        source_event_id=event.id,
                        source_chapter_version_id=version.id,
                        story_time=event.story_time,
                    )
            candidate.status = CandidateStatus.ADOPTED
            candidate.adopted_version_id = version.id
            return version
        except Exception:
            # Restore all aggregate fields while keeping the same Work object.
            work.__dict__.clear()
            work.__dict__.update(snapshot.__dict__)
            raise

    def run_until(
        self,
        work_id: str,
        target_chapter: int,
        *,
        run_id: Optional[str] = None,
        checkers: Iterable[CandidateChecker] = (PassChecker(),),
        crash_after_phase: Optional[str] = None,
    ) -> Checkpoint:
        """Generate/adopt sequentially and resume from the durable checkpoint.

        ``crash_after_phase`` is a test hook: ``generated`` or ``checked``
        raises after persisting that checkpoint. Calling again with the same
        ``run_id`` reuses the candidate and continues idempotently.
        """
        work = self.works[work_id]
        # A caller may pass a generator; every chapter must receive the same
        # checker set, so materialize it once for the run.
        checkers = tuple(checkers)
        run_id = run_id or _id("run")
        cp = work.checkpoints.get(run_id)
        if cp is None:
            cp = Checkpoint(run_id=run_id, work_id=work.id, target_chapter=target_chapter)
            work.checkpoints[run_id] = cp
        else:
            cp.target_chapter = max(cp.target_chapter, target_chapter)

        while cp.next_chapter <= cp.target_chapter:
            chapter = cp.next_chapter
            candidate_id = cp.candidate_ids.get(chapter)
            candidate = (
                work.candidates[candidate_id]
                if candidate_id and candidate_id in work.candidates
                else self.generate_candidate(work.id, chapter, run_id=run_id)
            )
            cp.candidate_ids[chapter] = candidate.id
            cp.phase = "generated"
            cp.updated_at = _now()
            if crash_after_phase == "generated":
                raise SimulatedCrash("worker stopped after generation checkpoint")

            self.run_checks(work.id, candidate.id, checkers)
            cp.phase = "checked"
            cp.updated_at = _now()
            if crash_after_phase == "checked":
                raise SimulatedCrash("worker stopped after check checkpoint")

            self.adopt_candidate(work.id, candidate.id)
            cp.next_chapter = chapter + 1
            cp.phase = "adopted"
            cp.updated_at = _now()
        cp.phase = "complete"
        cp.updated_at = _now()
        return cp

    def edit_adopted_chapter(
        self,
        work_id: str,
        chapter_number: int,
        content: str,
        *,
        reason: str = "early chapter edited",
        checkers: Iterable[CandidateChecker] = (PassChecker(),),
    ) -> ChapterVersion:
        """Create a new adopted revision and mark all later chapters stale.

        The old version remains in history.  Later versions/events are kept for
        audit but excluded from active state until regenerated/revalidated.
        """
        work = self.works[work_id]
        old = work.current_version(chapter_number)
        if old is None:
            raise ValueError(f"chapter {chapter_number} is not adopted")
        candidate = ChapterCandidate(
            id=_id("candidate"),
            work_id=work.id,
            chapter_number=chapter_number,
            content=content,
            proposed_events=[],  # editing prose alone does not invent facts
            run_id=_id("edit"),
        )
        work.candidates[candidate.id] = candidate
        self.run_checks(work.id, candidate.id, checkers)
        version = self.adopt_candidate(work.id, candidate.id)
        affected: List[int] = []
        for number, ids in work.versions_by_chapter.items():
            if number > chapter_number:
                affected.append(number)
                for version_id in ids:
                    later = work.versions[version_id]
                    if later.status == VersionStatus.ADOPTED:
                        later.stale = True
                        if version.id not in later.affected_by:
                            later.affected_by.append(version.id)
                        for event in work.events.values():
                            if event.chapter_version_id == later.id:
                                event.active = False
        work.impacts.append(
            ImpactRecord(
                id=_id("impact"),
                work_id=work.id,
                changed_chapter_number=chapter_number,
                affected_chapter_numbers=sorted(set(affected)),
                reason=reason,
            )
        )
        self._rebuild_states(work)
        return version

    @staticmethod
    def _rebuild_states(work: Work) -> None:
        work.states.clear()
        for event in sorted(work.events.values(), key=lambda e: (e.chapter_number, e.id)):
            if not event.active:
                continue
            if event.event_type == "character_state":
                work.states[(event.subject_id, event.predicate)] = CharacterState(
                    character_id=event.subject_id,
                    field=event.predicate,
                    value=event.value,
                    source_event_id=event.id,
                    source_chapter_version_id=event.chapter_version_id,
                    story_time=event.story_time,
                )

    @staticmethod
    def content_checksum(content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()


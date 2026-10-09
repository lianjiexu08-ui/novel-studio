import unittest

from core import (
    AdoptionBlocked,
    CandidateStatus,
    CheckStatus,
    DeterministicFakeProvider,
    NovelService,
    PassChecker,
    SimulatedCrash,
    UnavailableChecker,
)


class NovelServiceIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.service = NovelService(DeterministicFakeProvider())
        self.work = self.service.create_work("The Twelve Gates")

    def test_twelve_chapters_form_a_sequential_story(self):
        # Materializing an Iterable of checkers is part of run idempotency;
        # this generator must be reused for every chapter.
        checkpoint = self.service.run_until(
            self.work.id, 12, checkers=(checker for checker in [PassChecker()])
        )
        self.assertEqual(checkpoint.phase, "complete")
        self.assertEqual(checkpoint.next_chapter, 13)
        versions = self.work.adopted_versions()
        self.assertEqual(len(versions), 12)
        self.assertEqual([v.chapter_number for v in versions], list(range(1, 13)))
        self.assertEqual(self.work.states[("hero", "power")].value, 12)

    def test_candidate_events_do_not_pollute_state_before_adoption(self):
        candidate = self.service.generate_candidate(self.work.id, 1)
        self.assertEqual(candidate.status, CandidateStatus.CANDIDATE)
        self.assertEqual(self.work.events, {})
        # A candidate's proposed event is not canonical before adoption.
        self.assertEqual(self.work.states, {})
        self.service.run_checks(self.work.id, candidate.id, [PassChecker()])
        self.service.adopt_candidate(self.work.id, candidate.id)
        self.assertEqual(self.work.states[("hero", "power")].value, 1)

    def test_unavailable_checker_blocks_adoption(self):
        candidate = self.service.generate_candidate(self.work.id, 1)
        self.service.run_checks(
            self.work.id, candidate.id, [PassChecker(), UnavailableChecker()]
        )
        with self.assertRaises(AdoptionBlocked):
            self.service.adopt_candidate(self.work.id, candidate.id)
        self.assertEqual(candidate.status, CandidateStatus.CANDIDATE)
        self.assertEqual(self.work.adopted_versions(), [])
        self.assertTrue(any(c.status == CheckStatus.UNAVAILABLE for c in candidate.checks))

    def test_early_edit_marks_later_chapters_and_deactivates_old_events(self):
        self.service.run_until(self.work.id, 5)
        old_ch5 = self.work.current_version(5)
        self.assertIsNotNone(old_ch5)
        edited = self.service.edit_adopted_chapter(
            self.work.id, 2, "Chapter 2: the hero chooses a different gate."
        )
        self.assertEqual(edited.revision, 2)
        self.assertEqual(self.work.current_version(2).id, edited.id)
        for chapter in range(3, 6):
            self.assertTrue(self.work.current_version(chapter).stale)
            self.assertIn(edited.id, self.work.current_version(chapter).affected_by)
        self.assertEqual(self.work.impacts[-1].affected_chapter_numbers, [3, 4, 5])
        # Chapter 1 remains valid; chapter 2+ evidence was invalidated by the
        # early edit and therefore cannot contribute the old power value.
        self.assertEqual(self.work.states[("hero", "power")].value, 1)
        self.assertTrue(
            all(
                not event.active
                for event in self.work.events.values()
                if event.chapter_number >= 2
            )
        )

    def test_checkpoint_resume_is_idempotent_after_worker_crash(self):
        run_id = "run-recover"
        with self.assertRaises(SimulatedCrash):
            self.service.run_until(
                self.work.id, 3, run_id=run_id, crash_after_phase="generated"
            )
        cp = self.work.checkpoints[run_id]
        self.assertEqual(cp.next_chapter, 1)
        candidate_id = cp.candidate_ids[1]
        self.service.run_until(self.work.id, 3, run_id=run_id)
        self.assertEqual(len(self.work.adopted_versions()), 3)
        # A second resume must not duplicate versions, events, or candidates.
        self.service.run_until(self.work.id, 3, run_id=run_id)
        self.assertEqual(len(self.work.adopted_versions()), 3)
        self.assertEqual(len(self.work.events), 3)
        self.assertEqual(self.work.checkpoints[run_id].candidate_ids[1], candidate_id)


if __name__ == "__main__":
    unittest.main()


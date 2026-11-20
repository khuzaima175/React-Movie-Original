import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialBackgroundJobs,
  transitionJobState,
  getActiveBackgroundJobNotice
} from "../src/services/backgroundJobService.js";

test("transitionJobState tracks running/done/error states and ignores stale job IDs", () => {
  const init = createInitialBackgroundJobs();
  const started = transitionJobState(init, "forYou", {
    jobId: 2,
    status: "running",
    label: "Expanding library (90 → 250 films)…",
    targetRoute: "/explore?mode=for-you"
  });
  assert.equal(started.forYou.status, "running");
  assert.equal(started.forYou.jobId, 2);

  // Stale jobId 1 completion must be ignored
  const afterStale = transitionJobState(started, "forYou", {
    jobId: 1,
    status: "done",
    label: "Old job done"
  });
  assert.equal(afterStale.forYou.status, "running");
  assert.equal(afterStale.forYou.jobId, 2);

  // Current jobId 2 completion applies cleanly
  const done = transitionJobState(started, "forYou", {
    jobId: 2,
    status: "done",
    label: "250 personalized matches are ready",
    count: 250
  });
  assert.equal(done.forYou.status, "done");
  assert.equal(done.forYou.dismissed, false);
});

test("getActiveBackgroundJobNotice hides running banner on the job's own page and surfaces floating pill + View CTA while roaming", () => {
  let jobs = createInitialBackgroundJobs();
  jobs = transitionJobState(jobs, "forYou", {
    jobId: 1,
    status: "running",
    label: "Curating Movies You'll Like…",
    targetRoute: "/explore?mode=for-you"
  });

  // On /explore itself -> inline progress handles it, no duplicate floating pill
  assert.equal(getActiveBackgroundJobNotice(jobs, "/explore"), null);

  // Roaming on / or /movie/... -> floating pill appears!
  const roamingNotice = getActiveBackgroundJobNotice(jobs, "/movie/tt1375666");
  assert.ok(roamingNotice);
  assert.equal(roamingNotice.jobKey, "forYou");
  assert.equal(roamingNotice.status, "running");
  assert.equal(roamingNotice.targetRoute, "/explore?mode=for-you");

  // Completing while roaming -> clickable "done" notice with View CTA
  jobs = transitionJobState(jobs, "forYou", {
    jobId: 1,
    status: "done",
    label: "Your 250 personalized matches are ready"
  });
  const doneNotice = getActiveBackgroundJobNotice(jobs, "/movie/tt1375666");
  assert.ok(doneNotice);
  assert.equal(doneNotice.status, "done");
  assert.match(doneNotice.message, /250/);

  // Once dismissed -> returns null
  jobs = transitionJobState(jobs, "forYou", { jobId: 1, dismissed: true });
  assert.equal(getActiveBackgroundJobNotice(jobs, "/movie/tt1375666"), null);
});

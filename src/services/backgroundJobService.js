const DEFAULT_ROUTES = {
  forYou: "/explore?mode=for-you",
  oracle: "/ai"
};

const OWN_PATHS = {
  forYou: "/explore",
  oracle: "/ai"
};

function makeEmptyJob(jobKey) {
  return {
    jobId: 0,
    status: "idle", // "idle" | "running" | "done" | "error"
    stage: "",
    label: "",
    count: 0,
    targetRoute: DEFAULT_ROUTES[jobKey] || "/",
    dismissed: false,
    updatedAt: 0
  };
}

export function createInitialBackgroundJobs() {
  return {
    forYou: makeEmptyJob("forYou"),
    oracle: makeEmptyJob("oracle")
  };
}

/**
 * Pure monotonic job transition reducer: ignores stale jobIds so rapid refreshes
 * or overlapping background runs can never overwrite a newer job's status.
 */
export function transitionJobState(jobs, jobKey, patch = {}) {
  const base = jobs && typeof jobs === "object" ? jobs : createInitialBackgroundJobs();
  const prev = base[jobKey] || makeEmptyJob(jobKey);
  const incomingId = patch.jobId !== undefined ? Number(patch.jobId) : prev.jobId;

  if (Number.isFinite(incomingId) && incomingId > 0 && prev.jobId > 0 && incomingId < prev.jobId) {
    return base;
  }

  const nextJobId = Number.isFinite(incomingId) ? incomingId : prev.jobId;
  const isNewJob = nextJobId > prev.jobId;
  const nextStatus = patch.status ?? prev.status;
  const transitionedToDone = nextStatus === "done" && prev.status !== "done";
  const resetDismissed =
    patch.dismissed !== undefined
      ? Boolean(patch.dismissed)
      : isNewJob || transitionedToDone
        ? false
        : prev.dismissed;

  const nextJob = {
    ...prev,
    ...patch,
    jobId: nextJobId,
    status: nextStatus,
    targetRoute: patch.targetRoute || prev.targetRoute || DEFAULT_ROUTES[jobKey] || "/",
    dismissed: resetDismissed
  };

  const unchanged =
    nextJob.jobId === prev.jobId &&
    nextJob.status === prev.status &&
    nextJob.stage === prev.stage &&
    nextJob.label === prev.label &&
    nextJob.count === prev.count &&
    nextJob.targetRoute === prev.targetRoute &&
    nextJob.dismissed === prev.dismissed;

  if (unchanged) {
    return base;
  }

  return {
    ...base,
    [jobKey]: {
      ...nextJob,
      updatedAt: Number(patch.updatedAt) || Date.now()
    }
  };
}

/**
 * Selects the highest-priority background job notice to display as a floating
 * pill/toast while the user roams other pages. Returns null on the job's own page
 * (where inline status is already shown) or when dismissed/idle.
 */
export function getActiveBackgroundJobNotice(jobs = {}, currentPathname = "/") {
  const path = String(currentPathname || "/").toLowerCase();
  const keys = ["oracle", "forYou"];

  // Prioritize newly finished jobs first so "Ready · View ->" surfaces immediately
  for (const priorityStatus of ["done", "running"]) {
    for (const key of keys) {
      const job = jobs?.[key];
      if (!job || job.dismissed || job.status !== priorityStatus) continue;
      const ownPrefix = OWN_PATHS[key];
      if (ownPrefix && path.startsWith(ownPrefix)) continue;

      return {
        visible: true,
        jobKey: key,
        jobId: job.jobId,
        status: job.status,
        message:
          job.label ||
          (job.status === "done"
            ? key === "oracle"
              ? "Your Film Oracle picks are ready"
              : "Your Movies You'll Like catalog is ready"
            : key === "oracle"
              ? "Curating Film Oracle picks in the background…"
              : "Building Movies You'll Like in the background…"),
        targetRoute: job.targetRoute || DEFAULT_ROUTES[key] || "/"
      };
    }
  }

  return null;
}

"use client";

import { useEffect, useState } from "react";

type Stats = {
  connectionsCount: number;
  registeredAgents: number;
  dealsReleased?: number;
  dealsInProgress?: number;
};

export function StatsBanner() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setErr(data.error);
        else setStats(data);
      })
      .catch(() => setErr("Could not load stats"));
  }, []);

  if (err) {
    return (
      <p className="text-sm text-amber-400/90">
        Stats unavailable (check <code className="text-[var(--foreground)]">MONGODB_URI</code>).
      </p>
    );
  }
  if (!stats) {
    return <p className="text-sm text-[var(--muted)]">Loading marketplace stats…</p>;
  }

  return (
    <div className="space-y-1 text-lg text-[var(--foreground)]">
      <p>
        <span className="font-semibold text-[var(--accent)]">
          {stats.connectionsCount}
        </span>{" "}
        checkout starts
        <span className="mx-2 text-[var(--muted)]">·</span>
        <span className="font-semibold text-[var(--accent)]">
          {stats.registeredAgents}
        </span>{" "}
        agents registered
      </p>
      {(stats.dealsReleased != null || stats.dealsInProgress != null) && (
        <p className="text-base text-[var(--muted)]">
          <span className="font-semibold text-[var(--accent)]">
            {stats.dealsReleased ?? 0}
          </span>{" "}
          deals completed (data released)
          <span className="mx-2">·</span>
          <span className="font-semibold text-[var(--accent)]">
            {stats.dealsInProgress ?? 0}
          </span>{" "}
          in progress
        </p>
      )}
    </div>
  );
}

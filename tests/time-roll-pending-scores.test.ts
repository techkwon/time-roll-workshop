import assert from "node:assert/strict";
import test from "node:test";

import type * as LeaderboardModule from "../app/timeRollLeaderboard";

const leaderboardUrl = new URL("../app/timeRollLeaderboard.ts", import.meta.url);
const leaderboard = await import(leaderboardUrl.href) as typeof LeaderboardModule;
const {
  PENDING_LEADERBOARD_KEY,
  enqueuePendingLeaderboardSubmission,
  loadPendingLeaderboardSubmissions,
  removePendingLeaderboardSubmission,
} = leaderboard;
type StorageLike = Parameters<typeof loadPendingLeaderboardSubmissions>[0];
type LeaderboardSubmitPayload = Parameters<typeof enqueuePendingLeaderboardSubmission>[1];

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function payload(runId: string): LeaderboardSubmitPayload {
  return {
    runId,
    nickname: "복구로봇",
    scoreVersion: 1,
    collectionScore: 900,
    comboBonus: 108,
    timeBonus: 0,
    clearBonus: 0,
    totalScore: 1008,
    maxCombo: 2,
    startedEra: 1,
    reachedEra: 1,
    completedEras: 0,
    victory: false,
  };
}

test("queues a validated terminal score and removes it after confirmation", () => {
  const storage = memoryStorage();
  const queued = payload("pending_run_20260731_a");

  assert.equal(enqueuePendingLeaderboardSubmission(storage, queued), true);
  assert.deepEqual(loadPendingLeaderboardSubmissions(storage), [queued]);

  removePendingLeaderboardSubmission(storage, queued.runId);
  assert.deepEqual(loadPendingLeaderboardSubmissions(storage), []);
  assert.equal(storage.getItem(PENDING_LEADERBOARD_KEY), null);
});

test("replaces the same run and bounds recovery storage to three records", () => {
  const storage = memoryStorage();
  const first = payload("pending_run_20260731_a");
  assert.equal(enqueuePendingLeaderboardSubmission(storage, first), true);
  assert.equal(
    enqueuePendingLeaderboardSubmission(storage, { ...first, nickname: "다시로봇" }),
    true,
  );
  assert.equal(enqueuePendingLeaderboardSubmission(storage, payload("pending_run_20260731_b")), true);
  assert.equal(enqueuePendingLeaderboardSubmission(storage, payload("pending_run_20260731_c")), true);
  assert.equal(enqueuePendingLeaderboardSubmission(storage, payload("pending_run_20260731_d")), true);

  const loaded = loadPendingLeaderboardSubmissions(storage);
  assert.deepEqual(
    loaded.map((entry) => entry.runId),
    ["pending_run_20260731_b", "pending_run_20260731_c", "pending_run_20260731_d"],
  );
});

test("drops corrupt or invalid recovery data without interrupting the game", () => {
  const storage = memoryStorage();
  storage.setItem(PENDING_LEADERBOARD_KEY, "{broken");
  assert.deepEqual(loadPendingLeaderboardSubmissions(storage), []);

  storage.setItem(
    PENDING_LEADERBOARD_KEY,
    JSON.stringify([{ ...payload("pending_run_20260731_a"), nickname: "3학년1반" }]),
  );
  assert.deepEqual(loadPendingLeaderboardSubmissions(storage), []);
});

test("storage write failures do not block the score submission path", () => {
  const storage: StorageLike = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => undefined,
  };

  assert.equal(
    enqueuePendingLeaderboardSubmission(storage, payload("pending_run_20260731_a")),
    false,
  );
});

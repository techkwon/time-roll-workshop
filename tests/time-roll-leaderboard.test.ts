import assert from "node:assert/strict";
import test from "node:test";

import type * as LeaderboardModule from "../app/timeRollLeaderboard";

const leaderboardUrl = new URL("../app/timeRollLeaderboard.ts", import.meta.url);
const leaderboard = await import(leaderboardUrl.href) as typeof LeaderboardModule;

const validPayload = {
  runId: "run_20260731_abcdef",
  nickname: "한별7",
  scoreVersion: 1,
  collectionScore: 3200,
  comboBonus: 640,
  timeBonus: 1200,
  clearBonus: 1600,
  totalScore: 6640,
  maxCombo: 12,
  startedEra: 2,
  reachedEra: 3,
  completedEras: 1,
  victory: false,
};

function expectError(payload: unknown, code: string) {
  const result = leaderboard.validateLeaderboardPayload(payload);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, code);
    assert.match(result.error.message, /[가-힣]/u);
  }
}

test("accepts a valid Korean nickname and normalizes it", () => {
  const result = leaderboard.validateLeaderboardPayload(validPayload);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.nickname, "한별7");
    assert.equal(result.nicknameKey, "한별7");
  }
});

test("accepts era-one time-up runs with score and zero completed eras", () => {
  const result = leaderboard.validateLeaderboardPayload({
    ...validPayload,
    runId: "run_20260731_zero",
    collectionScore: 900,
    comboBonus: 108,
    timeBonus: 0,
    clearBonus: 0,
    totalScore: 1008,
    startedEra: 1,
    reachedEra: 1,
    completedEras: 0,
  });

  assert.equal(result.ok, true);
});

test("rejects nickname length, symbols, profanity, and PII school patterns", () => {
  expectError({ ...validPayload, nickname: "가" }, "NICKNAME_LENGTH");
  expectError({ ...validPayload, nickname: "한별!" }, "NICKNAME_CHARACTERS");
  expectError({ ...validPayload, nickname: "시발점" }, "NICKNAME_PROFANITY");
  expectError({ ...validPayload, nickname: "3학년1반" }, "NICKNAME_PII");
});

test("rejects score sum, time bonus, and clear bonus mismatches", () => {
  expectError({ ...validPayload, totalScore: 1 }, "SCORE_SUM");
  expectError({ ...validPayload, timeBonus: 21, totalScore: 5461 }, "TIME_BONUS");
  expectError({ ...validPayload, clearBonus: 0, totalScore: 5040 }, "CLEAR_BONUS");
  expectError({ ...validPayload, comment: "좋았어요" }, "PAYLOAD_INVALID");
});

test("rejects caps, max combo, era range, and victory constraint", () => {
  expectError(
    {
      ...validPayload,
      collectionScore: 300001,
      totalScore: 303441,
    },
    "SCORE_CAP"
  );
  expectError({ ...validPayload, maxCombo: 201 }, "MAX_COMBO");
  expectError({ ...validPayload, completedEras: 6 }, "ERA_RANGE");
  expectError({ ...validPayload, reachedEra: 4 }, "ERA_RANGE");
  expectError({
    ...validPayload,
    startedEra: 1,
    reachedEra: 5,
    completedEras: 4,
    clearBonus: 6400,
    totalScore: 11440,
    victory: true,
  }, "VICTORY_CONSTRAINT");
});

test("accepts resumed victory records when completed eras match the started era", () => {
  const result = leaderboard.validateLeaderboardPayload({
    ...validPayload,
    runId: "run_20260731_win5",
    startedEra: 5,
    reachedEra: 5,
    completedEras: 1,
    clearBonus: 1600,
    totalScore: 6640,
    victory: true,
  });

  assert.equal(result.ok, true);
});

test("accepts full victory records from era one", () => {
  const result = leaderboard.validateLeaderboardPayload({
    ...validPayload,
    runId: "run_20260731_fullwin",
    startedEra: 1,
    reachedEra: 5,
    completedEras: 5,
    clearBonus: 8000,
    timeBonus: 2000,
    totalScore: 13840,
    victory: true,
  });

  assert.equal(result.ok, true);
});

test("detects exact duplicate submissions and conflicting run reuse", () => {
  const result = leaderboard.validateLeaderboardPayload(validPayload);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const entry = {
    ...result.payload,
    id: "entry-id",
    nicknameKey: result.nicknameKey,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  };

  assert.equal(
    leaderboard.leaderboardSubmissionMatches(entry, result.payload, result.nicknameKey),
    true
  );
  assert.equal(
    leaderboard.leaderboardSubmissionMatches(
      { ...entry, totalScore: entry.totalScore + 1 },
      result.payload,
      result.nicknameKey
    ),
    false
  );
});

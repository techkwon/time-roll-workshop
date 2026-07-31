import assert from "node:assert/strict";
import test from "node:test";

import type * as ProgressModule from "../app/timeRollProgress";

const progressUrl = new URL("../app/timeRollProgress.ts", import.meta.url);
const progress = await import(progressUrl.href) as typeof ProgressModule;

test("defaults to a v3 replay-safe save shape", () => {
  assert.deepEqual(progress.defaultProgress(), {
    version: 3,
    bestEra: 0,
    bestSize: 0,
    totalScore: 0,
    eras: {},
    storyEndingSeen: false,
    bgmEnabled: true,
    sfxEnabled: true,
  });
});

test("migrates v1 best era and size while adding v3 audio fields", () => {
  assert.deepEqual(progress.parseProgressJson(JSON.stringify({ bestEra: 3.8, bestSize: 42.5 }), { maxEraIndex: 4 }), {
    version: 3,
    bestEra: 3,
    bestSize: 42.5,
    totalScore: 0,
    eras: {},
    storyEndingSeen: false,
    bgmEnabled: true,
    sfxEnabled: true,
  });
});

test("migrates v2 soundEnabled to both audio flags", () => {
  assert.equal(progress.parseProgressJson(JSON.stringify({ version: 2, soundEnabled: true })).bgmEnabled, true);
  assert.equal(progress.parseProgressJson(JSON.stringify({ version: 2, soundEnabled: true })).sfxEnabled, true);
  assert.equal(progress.parseProgressJson(JSON.stringify({ version: 2, soundEnabled: false })).bgmEnabled, false);
  assert.equal(progress.parseProgressJson(JSON.stringify({ version: 2, soundEnabled: false })).sfxEnabled, false);
});

test("malformed and unknown save payloads return defaults", () => {
  assert.deepEqual(progress.parseProgressJson("{not-json"), progress.defaultProgress());
  assert.deepEqual(progress.parseProgressJson("null"), progress.defaultProgress());
  assert.deepEqual(progress.parseProgressJson(JSON.stringify({ version: 99, bestEra: 4 })), progress.defaultProgress());
});

test("normalizes v3 fields without trusting malformed values", () => {
  const parsed = progress.parseProgressJson(
    JSON.stringify({
      version: 3,
      bestEra: 12,
      bestSize: -10,
      totalScore: 999,
      eras: {
        "1": { bestScore: 200, maxCombo: 8.9, bestRank: "A", completed: true },
        "2": { bestScore: -50, maxCombo: "bad", bestRank: "SS", completed: "yes" },
        "02": { bestScore: 999, maxCombo: 99, bestRank: "S", completed: true },
        broken: { bestScore: 999, maxCombo: 99, bestRank: "S", completed: true },
      },
      storyEndingSeen: "true",
      bgmEnabled: false,
      sfxEnabled: true,
    }),
    { maxEraIndex: 4 },
  );

  assert.deepEqual(parsed, {
    version: 3,
    bestEra: 4,
    bestSize: 0,
    totalScore: 200,
    eras: {
      "1": { bestScore: 200, maxCombo: 8, bestRank: "A", completed: true },
      "2": { bestScore: 0, maxCombo: 0, bestRank: "B", completed: false },
    },
    storyEndingSeen: false,
    bgmEnabled: false,
    sfxEnabled: true,
  });
});

test("keeps v3 bgm and sfx flags independent", () => {
  assert.deepEqual(progress.parseProgressJson(JSON.stringify({
    version: 3,
    bgmEnabled: false,
    sfxEnabled: true,
  })), {
    version: 3,
    bestEra: 0,
    bestSize: 0,
    totalScore: 0,
    eras: {},
    storyEndingSeen: false,
    bgmEnabled: false,
    sfxEnabled: true,
  });
});

test("records era results immutably with rank ordering S over A over B", () => {
  const initial = progress.defaultProgress({ maxEraIndex: 4 });
  const first = progress.recordEraResult(initial, {
    era: 1,
    score: 120,
    maxCombo: 5,
    rank: "A",
    completed: true,
    size: 30,
  }, { maxEraIndex: 4 });
  const second = progress.recordEraResult(first, {
    era: 1,
    score: 90,
    maxCombo: 9,
    rank: "S",
    completed: false,
    size: 28,
  }, { maxEraIndex: 4 });

  assert.deepEqual(initial.eras, {});
  assert.equal(first.bestEra, 2);
  assert.equal(second.bestEra, 2);
  assert.equal(second.bestSize, 30);
  assert.equal(second.totalScore, 120);
  assert.deepEqual(second.eras["1"], {
    bestScore: 120,
    maxCombo: 9,
    bestRank: "S",
    completed: true,
  });
});

test("resetProgress returns a fresh default object", () => {
  const reset = progress.resetProgress({ defaultBgmEnabled: false, defaultSfxEnabled: true });

  assert.deepEqual(reset, {
    version: 3,
    bestEra: 0,
    bestSize: 0,
    totalScore: 0,
    eras: {},
    storyEndingSeen: false,
    bgmEnabled: false,
    sfxEnabled: true,
  });
  assert.notEqual(reset, progress.defaultProgress({ defaultBgmEnabled: false, defaultSfxEnabled: true }));
});

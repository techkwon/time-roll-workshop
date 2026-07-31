import assert from "node:assert/strict";
import test from "node:test";

import type * as ScoreModule from "../app/timeRollScore";

const scoreUrl = new URL("../app/timeRollScore.ts", import.meta.url);
const score = await import(scoreUrl.href) as typeof ScoreModule;

test("pickup scoring matches versioned collection, combo, and clear rules", () => {
  assert.equal(score.TIME_ROLL_SCORE_VERSION, 1);
  assert.deepEqual(
    score.calculatePickupScore({ sizeRatio: 1.234, isFocus: true, special: true, combo: 3.9 }),
    {
      collectionScore: 1231,
      comboBonus: 443,
      clearBonus: 1600,
      totalScore: 3274,
    }
  );
});

test("combo and time bonuses clamp and round at their caps", () => {
  assert.deepEqual(
    score.calculatePickupScore({ sizeRatio: 1, isFocus: false, special: false, combo: 20 }),
    {
      collectionScore: 945,
      comboBonus: 907,
      clearBonus: 0,
      totalScore: 1852,
    }
  );
  assert.equal(score.timeBonusFor(-1), 0);
  assert.equal(score.timeBonusFor(0.1), 20);
  assert.equal(score.timeBonusFor(100.1), 2000);
  assert.equal(score.calculateTimeBonus(12.2), 260);
});

test("score breakdown helpers create immutable merged totals", () => {
  const first = score.createScoreBreakdown({ collectionScore: 10, comboBonus: 2 });
  const second = score.createScoreBreakdown({ timeBonus: 20, clearBonus: 1600 });
  const merged = score.mergeScoreBreakdowns(first, second);

  assert.deepEqual(first, {
    collectionScore: 10,
    comboBonus: 2,
    timeBonus: 0,
    clearBonus: 0,
    totalScore: 12,
  });
  assert.deepEqual(merged, {
    collectionScore: 10,
    comboBonus: 2,
    timeBonus: 20,
    clearBonus: 1600,
    totalScore: 1632,
  });
  assert.equal(score.totalScoreForBreakdown(merged), 1632);
});

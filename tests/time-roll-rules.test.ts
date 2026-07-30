import assert from "node:assert/strict";
import test from "node:test";

import type * as RuleModule from "../app/timeRollRules";

const rulesUrl = new URL("../app/timeRollRules.ts", import.meta.url);
const rules = await import(rulesUrl.href) as typeof RuleModule;

test("starts tiny and cannot collect bigger objects yet", () => {
  const base = 10;
  const player = { radius: rules.startingRadius(base) };
  const tinyItem = { radius: rules.TIERS.tiny.itemRadiusRangeRatio[1] * base };
  const smallItem = { radius: rules.TIERS.small.itemRadiusRangeRatio[0] * base };
  const largeItem = { radius: rules.TIERS.large.itemRadiusRangeRatio[0] * base };

  assert.equal(rules.START_RADIUS_RATIO, 0.18);
  assert.equal(rules.COLLECT_RATIO, 0.82);
  assert.equal(rules.growthTier(player, base).id, "tiny");
  assert.equal(rules.canCollect(player, tinyItem, true), true);
  assert.equal(rules.canCollect(player, smallItem, true), false);
  assert.equal(rules.canCollect(player, largeItem, true), false);
  assert.equal(rules.nextTier(player, base)?.id, "small");
});

test("repeated small absorbs raise the tier and unlock the previously too-large item", () => {
  const base = 10;
  const blockedAtStart = { radius: rules.TIERS.small.itemRadiusRangeRatio[0] * base };
  const tinyCollectible = { radius: rules.TIERS.tiny.itemRadiusRangeRatio[1] * base };
  let radius = rules.startingRadius(base);

  assert.equal(rules.canCollect(radius, blockedAtStart, true), false);

  for (let count = 0; count < 8; count += 1) {
    radius = rules.absorbRadius(radius, tinyCollectible, 1);
  }

  assert.equal(rules.growthTier(radius, base).id, "small");
  assert.ok(rules.growthRatio(radius, base) >= rules.TIERS.small.thresholdRatio);
  assert.equal(rules.canCollect(radius, blockedAtStart, true), true);
});

test("special collectibles are blocked until specialReady is true", () => {
  const base = 10;
  const player = { radius: rules.BOSS_RADIUS_RATIO * base };
  const special = { radius: rules.TIERS.small.itemRadiusRangeRatio[0] * base, special: true };

  assert.equal(rules.canCollect(player, special, false), false);
  assert.equal(rules.canCollect(player, special, true), true);
});

test("physical size labels jump by era scale", () => {
  assert.equal(rules.formatPhysicalSize(1, 0), "약 55 cm");
  assert.equal(rules.formatPhysicalSize(1, 1), "약 2.2 m");
  assert.equal(rules.formatPhysicalSize(1, 4), "약 170 m");
  assert.equal(rules.formatPhysicalSize(20, 4), "약 3.4 km");
});

import assert from "node:assert/strict";
import test from "node:test";

import type * as PlacementModule from "../app/timeRollPlacement";

const placementUrl = new URL("../app/timeRollPlacement.ts", import.meta.url);
const placement = await import(placementUrl.href) as typeof PlacementModule;

const era = {
  baseRadius: 1,
  arenaUnits: 18,
};

const options = {
  eraIndex: 1,
  era,
  focusTheme: "construction",
  seed: 12345,
};

type TestItem = PlacementModule.PlacementItem & {
  name: string;
  theme: string;
  objectKind: number;
  collected: boolean;
};

function item(partial: Partial<TestItem> & Pick<TestItem, "id">): TestItem {
  return {
    id: partial.id,
    name: partial.name ?? `item-${partial.id}`,
    theme: partial.theme ?? "construction",
    objectKind: partial.objectKind ?? partial.id,
    x: partial.x ?? 0,
    z: partial.z ?? 0,
    r: partial.r ?? 0.5,
    collected: partial.collected ?? false,
    special: partial.special,
  };
}

function assertClose(actual: number, expected: number, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("resolveItemSpawnOverlaps is deterministic for the same input", () => {
  const input = [
    item({ id: 1, x: 4.9, z: -6.9, r: 0.6 }),
    item({ id: 2, x: 4.92, z: -6.88, r: 0.5 }),
    item({ id: 3, x: -1, z: -4, r: 0.4 }),
  ];

  const first = placement.resolveItemSpawnOverlaps(input, options);
  const second = placement.resolveItemSpawnOverlaps(input, options);

  assert.deepEqual(second, first);
});

test("severe small-inside-large pair overlaps are removed", () => {
  const input = [
    item({ id: 1, x: 0, z: -9, r: 2.1, theme: "transport", objectKind: 9 }),
    item({ id: 2, x: 0.1, z: -9.05, r: 0.2, theme: "life", objectKind: 1 }),
  ];
  const before = placement.diagnosePlacement(input, options);

  const resolved = placement.resolveItemSpawnOverlaps(input, options);
  const after = placement.diagnosePlacement(resolved, options);

  assert.equal(before.severePairCount, 1);
  assert.equal(after.severePairCount, 0);
  assert.equal(after.pairCount, 0);
});

test("protected large set-piece zone intrusions are removed", () => {
  const [zone] = placement.protectedZonesForEra(options);
  const input = [
    item({ id: 1, x: zone.x, z: zone.z, r: 0.35, objectKind: 0 }),
    item({ id: 2, x: -10, z: -10, r: 0.35, objectKind: 1 }),
  ];
  const before = placement.diagnosePlacement(input, options);

  const resolved = placement.resolveItemSpawnOverlaps(input, options);
  const after = placement.diagnosePlacement(resolved, options);

  assert.ok(before.setPieceIntrusions > 0);
  assert.equal(after.setPieceIntrusions, 0);
});

test("non-boss items are kept inside the playable arena", () => {
  const input = [
    item({ id: 1, x: 100, z: -100, r: 1.1, objectKind: 5 }),
    item({ id: 2, x: -100, z: 100, r: 0.8, objectKind: 6 }),
  ];

  const resolved = placement.resolveItemSpawnOverlaps(input, options);
  const after = placement.diagnosePlacement(resolved, options);

  assert.equal(after.outOfBounds, 0);
});

test("input items are not mutated and custom fields are preserved", () => {
  const input = [
    item({ id: 1, x: 4.9, z: -6.9, r: 0.6, collected: true }),
    item({ id: 2, x: 4.9, z: -6.9, r: 0.6, name: "preserve-me" }),
  ];
  const snapshot = structuredClone(input);

  const resolved = placement.resolveItemSpawnOverlaps(input, options);

  assert.deepEqual(input, snapshot);
  assert.equal(resolved.length, input.length);
  assert.equal(resolved[1].name, "preserve-me");
  assert.equal(resolved[0].collected, true);
});

test("already clean item positions remain unchanged", () => {
  const input = [
    item({ id: 1, x: -13, z: -13, r: 0.2, objectKind: 0 }),
    item({ id: 2, x: 0, z: 12, r: 0.2, objectKind: 1 }),
    item({ id: 3, x: 13, z: 13, r: 0.2, objectKind: 2 }),
  ];

  const resolved = placement.resolveItemSpawnOverlaps(input, options);

  assert.deepEqual(
    resolved.map(({ x, z }) => ({ x, z })),
    input.map(({ x, z }) => ({ x, z })),
  );
});

test("special boss item stays fixed while other items move around it", () => {
  const input = [
    item({ id: 1, x: 0, z: -12, r: 3.5, objectKind: 9, special: true }),
    item({ id: 2, x: 0.1, z: -12.1, r: 0.45, objectKind: 2 }),
  ];

  const resolved = placement.resolveItemSpawnOverlaps(input, options);
  const after = placement.diagnosePlacement(resolved, options);

  assert.equal(resolved[0].x, input[0].x);
  assert.equal(resolved[0].z, input[0].z);
  assert.notEqual(resolved[1].x, input[1].x);
  assert.equal(after.pairCount, 0);
});

test("placement footprint uses the same render scale for focus variants and bosses", () => {
  const focusVariant = item({
    id: 7,
    r: 1,
    theme: "construction",
    objectKind: 7,
  });
  const nonFocusVariant = item({
    id: 9,
    r: 1,
    theme: "transport",
    objectKind: 9,
  });
  const boss = item({
    id: 10,
    r: 1,
    theme: "construction",
    objectKind: 9,
    special: true,
  });

  assertClose(placement.itemRenderScale(focusVariant, "construction"), 1.3 * 1.17);
  assertClose(placement.itemRenderScale(nonFocusVariant, "construction"), 1.1 * 1.24);
  assertClose(placement.itemRenderScale(boss, "construction"), 1.08 * 1.24);
  assertClose(
    placement.footprintRadius(focusVariant, "construction"),
    placement.itemRenderScale(focusVariant, "construction") * 1.72,
  );
  assertClose(
    placement.footprintRadius(boss, "construction"),
    placement.itemRenderScale(boss, "construction") * 2.15,
  );
});

test("protected zones cover actual dressing-island and foreground slab corners", () => {
  const zones = placement.protectedZonesForEra(options);
  const dressingIsland = zones.find((zone) => zone.id === "dressing-island-left");
  const foregroundAnchor = zones.find((zone) => zone.id === "foreground-anchor-left");
  assert.ok(dressingIsland);
  assert.ok(foregroundAnchor);

  const dressingCornerDistance = Math.hypot(3.04 * 1.46, 2.52 * 1.46) * 0.5;
  const foregroundCornerDistance = Math.hypot(2.78 * 1.48, 2.34 * 1.48) * 0.5;
  assert.ok(dressingIsland.radius > dressingCornerDistance);
  assert.ok(foregroundAnchor.radius > foregroundCornerDistance);

  const corners = [
    item({
      id: 20,
      r: 0.01,
      x: dressingIsland.x + 3.04 * 1.46 * 0.5,
      z: dressingIsland.z + 2.52 * 1.46 * 0.5,
    }),
    item({
      id: 21,
      r: 0.01,
      x: foregroundAnchor.x + 2.78 * 1.48 * 0.5,
      z: foregroundAnchor.z + 2.34 * 1.48 * 0.5,
    }),
  ];
  const diagnostics = placement.diagnosePlacement(corners, options);

  assert.ok(
    diagnostics.intrusions.some(({ zone }) => zone.id === "dressing-island-left"),
  );
  assert.ok(
    diagnostics.intrusions.some(({ zone }) => zone.id === "foreground-anchor-left"),
  );
});

test("starter zone keeps oversized items away while preserving tiny pickups", () => {
  const oversized = item({
    id: 30,
    x: 0.2,
    z: 0.25,
    r: 0.42,
    objectKind: 8,
  });
  const tiny = item({
    id: 31,
    x: 0,
    z: -2.2,
    r: 0.1,
    objectKind: 0,
  });
  const before = placement.diagnosePlacement([oversized, tiny], options);

  const resolved = placement.resolveItemSpawnOverlaps([oversized, tiny], options);
  const after = placement.diagnosePlacement(resolved, options);

  assert.equal(before.starterIntrusions, 1);
  assert.equal(after.starterIntrusions, 0);
  assert.notDeepEqual(
    { x: resolved[0].x, z: resolved[0].z },
    { x: oversized.x, z: oversized.z },
  );
  assert.deepEqual(
    { x: resolved[1].x, z: resolved[1].z },
    { x: tiny.x, z: tiny.z },
  );
});

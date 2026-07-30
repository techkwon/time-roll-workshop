import assert from "node:assert/strict";
import test from "node:test";

import type * as VisualMathModule from "../app/timeRollVisualMath";

const visualMathUrl = new URL("../app/timeRollVisualMath.ts", import.meta.url);
const { robotMeshYaw, segmentTransform } = await import(
  visualMathUrl.href
) as typeof VisualMathModule;

test("robot mesh yaw matches the placement basis at every cardinal heading", () => {
  for (const heading of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const yaw = robotMeshYaw(heading);
    const meshRight = [Math.cos(yaw), -Math.sin(yaw)];
    const placementRight = [Math.cos(heading), Math.sin(heading)];
    const dot = meshRight[0] * placementRight[0] + meshRight[1] * placementRight[1];
    assert.ok(Math.abs(dot - 1) < 1e-10);
  }
});

test("segment transform points its local z axis from start to end", () => {
  const from: [number, number, number] = [1.2, 0.4, -0.8];
  const to: [number, number, number] = [-0.3, 1.7, 2.1];
  const transform = segmentTransform(from, to, 0.1);
  const [pitch, yaw] = transform.rotation;
  const transformedAxis = [
    Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  ];
  const delta = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  const expectedAxis = delta.map((value) => value / length);
  const dot = transformedAxis.reduce(
    (sum, value, index) => sum + value * expectedAxis[index],
    0,
  );

  assert.ok(Math.abs(dot - 1) < 1e-10);
  assert.ok(Math.abs(transform.scale[2] - length) < 1e-10);
  assert.deepEqual(transform.position, [0.44999999999999996, 1.05, 0.65]);
});

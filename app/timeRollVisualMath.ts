export type VisualVec3 = [number, number, number];

export function robotMeshYaw(heading: number) {
  return -heading;
}

export function segmentTransform(
  from: VisualVec3,
  to: VisualVec3,
  thickness: number,
) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const horizontal = Math.hypot(dx, dz);
  const length = Math.max(Math.hypot(horizontal, dy), thickness);

  return {
    position: [
      (from[0] + to[0]) * 0.5,
      (from[1] + to[1]) * 0.5,
      (from[2] + to[2]) * 0.5,
    ] as VisualVec3,
    scale: [thickness, thickness, length] as VisualVec3,
    rotation: [Math.atan2(-dy, horizontal), Math.atan2(dx, dz), 0] as VisualVec3,
  };
}

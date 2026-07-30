import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type * as PremiumMeshes from "../app/timeRollPremiumMeshes";

const moduleUrl = new URL("../app/timeRollPremiumMeshes.ts", import.meta.url);
const {
  makeCapsule,
  makeDish,
  makeRoundedBox,
  makeTorus,
  makeTruss,
  makeWheel,
} = await import(moduleUrl.href) as typeof PremiumMeshes;

type MeshFactory = () => PremiumMeshes.RawMesh;

const cases = [
  ["roundedBox", makeRoundedBox, 400, true],
  ["capsule", makeCapsule, 340, true],
  ["torus", makeTorus, 320, true],
  ["dish", makeDish, 180, false],
  ["truss", makeTruss, 240, true],
  ["wheel", makeWheel, 460, true],
] as const satisfies readonly [string, MeshFactory, number, boolean][];

function vec3(values: number[], index: number): [number, number, number] {
  const offset = index * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function subtract(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function positionKey(mesh: PremiumMeshes.RawMesh, index: number) {
  const point = vec3(mesh.positions, index);
  return point.map((value) => value.toFixed(5)).join(",");
}

function edgeKey(mesh: PremiumMeshes.RawMesh, a: number, b: number) {
  const keyA = positionKey(mesh, a);
  const keyB = positionKey(mesh, b);
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

function auditMesh(mesh: PremiumMeshes.RawMesh) {
  let degenerateTriangles = 0;
  let inwardTriangles = 0;
  const edges = new Map<string, number>();

  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i];
    const b = mesh.indices[i + 1];
    const c = mesh.indices[i + 2];
    const pa = vec3(mesh.positions, a);
    const pb = vec3(mesh.positions, b);
    const pc = vec3(mesh.positions, c);
    const faceNormal = cross(subtract(pb, pa), subtract(pc, pa));
    const area2 = Math.hypot(faceNormal[0], faceNormal[1], faceNormal[2]);
    if (area2 <= 1e-8) {
      degenerateTriangles += 1;
    }
    const na = vec3(mesh.normals, a);
    const nb = vec3(mesh.normals, b);
    const nc = vec3(mesh.normals, c);
    const normalSum: [number, number, number] = [
      na[0] + nb[0] + nc[0],
      na[1] + nb[1] + nc[1],
      na[2] + nb[2] + nc[2],
    ];
    if (area2 > 1e-8 && dot(faceNormal, normalSum) <= 1e-8) {
      inwardTriangles += 1;
    }
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(mesh, from, to);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  let boundaryEdges = 0;
  for (const count of edges.values()) {
    if (count !== 2) {
      boundaryEdges += 1;
    }
  }
  return { degenerateTriangles, inwardTriangles, boundaryEdges };
}

for (const [name, factory, triangleLimit, expectsClosed] of cases) {
  test(`${name} exports a bounded RawMesh-compatible surface`, () => {
    const mesh = factory();
    const vertexCount = mesh.positions.length / 3;
    const triangleCount = mesh.indices.length / 3;

    assert.ok(vertexCount > 0);
    assert.equal(mesh.positions.length % 3, 0);
    assert.equal(mesh.normals.length, mesh.positions.length);
    assert.equal(mesh.uvs.length, vertexCount * 2);
    assert.equal(mesh.indices.length % 3, 0);
    assert.ok(triangleCount <= triangleLimit, `${name} triangles ${triangleCount} > ${triangleLimit}`);

    for (const value of [...mesh.positions, ...mesh.normals, ...mesh.uvs]) {
      assert.ok(Number.isFinite(value), `${name} includes non-finite value`);
    }

    for (let i = 0; i < mesh.normals.length; i += 3) {
      const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
      assert.ok(length > 0.82 && length < 1.18, `${name} normal ${i / 3} length ${length}`);
    }

    for (const index of mesh.indices) {
      assert.ok(Number.isInteger(index), `${name} has non-integer index`);
      assert.ok(index >= 0 && index < vertexCount, `${name} index ${index} outside ${vertexCount}`);
    }
  });

  test(`${name} has visible outward triangles`, () => {
    const audit = auditMesh(factory());
    assert.equal(audit.degenerateTriangles, 0, `${name} degenerate triangles: ${audit.degenerateTriangles}`);
    assert.equal(audit.inwardTriangles, 0, `${name} inward triangles: ${audit.inwardTriangles}`);
    if (expectsClosed) {
      assert.equal(audit.boundaryEdges, 0, `${name} open boundary edges: ${audit.boundaryEdges}`);
    }
  });
}

test("dish remains intentionally open only at the rim", () => {
  const audit = auditMesh(makeDish());
  assert.equal(audit.degenerateTriangles, 0);
  assert.equal(audit.inwardTriangles, 0);
  assert.equal(audit.boundaryEdges, 18);
});

test("roundedBox detail option changes triangle count without opening the mesh", () => {
  const low = makeRoundedBox({ segments: 2 });
  const high = makeRoundedBox({ segments: 4 });
  assert.ok(low.indices.length / 3 < high.indices.length / 3);
  assert.equal(auditMesh(low).degenerateTriangles, 0);
  assert.equal(auditMesh(low).inwardTriangles, 0);
  assert.equal(auditMesh(low).boundaryEdges, 0);
  assert.equal(auditMesh(high).degenerateTriangles, 0);
  assert.equal(auditMesh(high).inwardTriangles, 0);
  assert.equal(auditMesh(high).boundaryEdges, 0);
});

test("renderer RawMesh validation rejects non-integer, negative, and out-of-range indices", () => {
  const source = readFileSync(new URL("../app/TimeRollGame.tsx", import.meta.url), "utf8");
  assert.match(source, /!Number\.isInteger\(index\)/);
  assert.match(source, /index < 0/);
  assert.match(source, /index >= vertexCount/);
});

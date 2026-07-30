import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const cc0MeshesUrl = new URL("../app/timeRollCc0Meshes.ts", import.meta.url);
const { KENNEY_FACTORY_MESHES } = await import(cc0MeshesUrl.href);

const expected = [
  "kenneyFactoryCogA",
  "kenneyFactoryConveyorLong",
  "kenneyFactoryScannerHigh",
  "kenneyFactoryScreenWide",
  "kenneyCarWheelDefault",
  "kenneyCarCone",
  "kenneyNatureTreeOak",
  "kenneyNatureMushroomRed",
];

const expectedTriangleCounts = {
  kenneyFactoryCogA: 160,
  kenneyFactoryConveyorLong: 188,
  kenneyFactoryScannerHigh: 236,
  kenneyFactoryScreenWide: 144,
  kenneyCarWheelDefault: 332,
  kenneyCarCone: 172,
  kenneyNatureTreeOak: 194,
  kenneyNatureMushroomRed: 48,
};

const triangleAt = (mesh, triangleIndex) => [
  mesh.indices[triangleIndex * 3],
  mesh.indices[triangleIndex * 3 + 1],
  mesh.indices[triangleIndex * 3 + 2],
];

function vec3At(values, index) {
  const offset = index * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function triangleArea(mesh, [aIndex, bIndex, cIndex]) {
  const a = vec3At(mesh.positions, aIndex);
  const b = vec3At(mesh.positions, bIndex);
  const c = vec3At(mesh.positions, cIndex);
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz) * 0.5;
}

function windingNormalDot(mesh, [aIndex, bIndex, cIndex]) {
  const a = vec3At(mesh.positions, aIndex);
  const b = vec3At(mesh.positions, bIndex);
  const c = vec3At(mesh.positions, cIndex);
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const faceNormal = [
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx,
  ];
  const normal = [aIndex, bIndex, cIndex].reduce(
    (sum, index) => {
      const value = vec3At(mesh.normals, index);
      return [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]];
    },
    [0, 0, 0],
  );
  return faceNormal[0] * normal[0] + faceNormal[1] * normal[1] + faceNormal[2] * normal[2];
}

function bbox(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length / 3; index += 1) {
    const point = vec3At(mesh.positions, index);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return min.map((value, axis) => max[axis] - value);
}

test("Kenney Factory Kit CC0 meshes are exported as WebGL-safe RawMesh data", () => {
  assert.deepEqual(Object.keys(KENNEY_FACTORY_MESHES), expected);

  for (const name of expected) {
    const mesh = KENNEY_FACTORY_MESHES[name];
    const vertexCount = mesh.positions.length / 3;
    const triangleCount = mesh.indices.length / 3;

    assert.equal(mesh.positions.length % 3, 0, `${name} positions are xyz triples`);
    assert.equal(mesh.normals.length, mesh.positions.length, `${name} has one normal per vertex`);
    assert.equal(mesh.uvs.length, vertexCount * 2, `${name} has one uv per vertex`);
    assert.equal(mesh.indices.length % 3, 0, `${name} indices form triangles`);
    assert.ok(vertexCount > 0, `${name} has vertices`);
    assert.ok(triangleCount > 0, `${name} has triangles`);
    assert.equal(triangleCount, expectedTriangleCounts[name], `${name} post-dedupe triangle count`);
    assert.ok(vertexCount <= 65535, `${name} stays inside UNSIGNED_SHORT index range`);
    assert.ok(triangleCount <= 5000, `${name} stays inside the mobile triangle budget`);
    assert.ok(triangleCount < 1500, `${name} stays under the CC0 per-mesh triangle cap`);
    assert.ok(Math.max(...mesh.indices) < vertexCount, `${name} indices stay in range`);
  }
});

test("Kenney Factory Kit CC0 meshes have no duplicate or degenerate triangles", () => {
  for (const name of expected) {
    const mesh = KENNEY_FACTORY_MESHES[name];
    const triangleKeys = new Set();
    for (let triangleIndex = 0; triangleIndex < mesh.indices.length / 3; triangleIndex += 1) {
      const triangle = triangleAt(mesh, triangleIndex);
      const key = triangle.join("|");
      assert.ok(!triangleKeys.has(key), `${name} has no duplicate triangle ${key}`);
      triangleKeys.add(key);
      assert.ok(triangleArea(mesh, triangle) > 1e-10, `${name} triangle ${triangleIndex} is nondegenerate`);
    }
  }
});

test("Kenney Factory Kit CC0 meshes have finite normalized normals and usable bounds", () => {
  for (const name of expected) {
    const mesh = KENNEY_FACTORY_MESHES[name];
    for (let index = 0; index < mesh.normals.length / 3; index += 1) {
      const normal = vec3At(mesh.normals, index);
      const length = Math.hypot(normal[0], normal[1], normal[2]);
      assert.ok(Number.isFinite(length), `${name} normal ${index} is finite`);
      assert.ok(Math.abs(length - 1) < 1e-3, `${name} normal ${index} is normalized`);
    }

    const extents = bbox(mesh);
    for (const [axis, extent] of extents.entries()) {
      assert.ok(extent > 0.05, `${name} bbox axis ${axis} is nontrivial`);
    }
  }
});

test("Kenney Factory Kit CC0 mesh winding agrees with average normals", () => {
  for (const name of expected) {
    const mesh = KENNEY_FACTORY_MESHES[name];
    let consistent = 0;
    const triangleCount = mesh.indices.length / 3;
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      if (windingNormalDot(mesh, triangleAt(mesh, triangleIndex)) > -1e-8) {
        consistent += 1;
      }
    }
    assert.ok(
      consistent / triangleCount > 0.94,
      `${name} winding and normals are consistent for at least 94% of faces`,
    );
  }
});

test("bundled CC0 source files and generated material atlas are present", async () => {
  const requiredFiles = [
    "public/textures/time-roll-material-atlas-5x5.png",
    "public/assets/cc0/kenney-factory-kit/License.txt",
    "public/assets/cc0/kenney-factory-kit/obj/cog-a.obj",
    "public/assets/cc0/kenney-factory-kit/obj/conveyor-long.obj",
    "public/assets/cc0/kenney-factory-kit/obj/scanner-high.obj",
    "public/assets/cc0/kenney-factory-kit/obj/screen-wide.obj",
    "public/assets/cc0/kenney-factory-kit/textures/colormap.png",
    "public/assets/cc0/kenney-car-kit/License.txt",
    "public/assets/cc0/kenney-car-kit/obj/wheel-default.obj",
    "public/assets/cc0/kenney-car-kit/obj/cone.obj",
    "public/assets/cc0/kenney-car-kit/textures/colormap.png",
    "public/assets/cc0/kenney-nature-kit/License.txt",
    "public/assets/cc0/kenney-nature-kit/obj/tree_oak.obj",
    "public/assets/cc0/kenney-nature-kit/obj/mushroom_red.obj",
  ];

  for (const file of requiredFiles) {
    const info = await stat(file);
    assert.ok(info.size > 0, `${file} is bundled`);
  }
});

test("generated 5x5 material atlas is grid-safe RGB without alpha", async () => {
  const atlas = await readFile("public/textures/time-roll-material-atlas-5x5.png");
  const pngSignature = "89504e470d0a1a0a";
  assert.equal(atlas.subarray(0, 8).toString("hex"), pngSignature);

  const width = atlas.readUInt32BE(16);
  const height = atlas.readUInt32BE(20);
  const colorType = atlas.readUInt8(25);

  assert.equal(width, 1250);
  assert.equal(height, 1250);
  assert.equal(width % 5, 0, "atlas width divides cleanly into five columns");
  assert.equal(height % 5, 0, "atlas height divides cleanly into five rows");
  assert.equal(colorType, 2, "PNG color type 2 is RGB with no alpha channel");
});

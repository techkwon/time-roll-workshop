import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const url = process.env.GAME_URL || "http://localhost:3000";
const saveKey = "time-roll-workshop-v1";
const bgmPath = "/audio/playful-chaos-hook.m4a";
const outputDir = new URL("../output/e2e/", import.meta.url);
const MOBILE_DRAW_CALL_CAP = 180;
const MOBILE_TRANSPARENT_CALL_CAP = 35;
const expectedVisualAssetPaths = [
  "/textures/time-roll-material-atlas-5x5.png",
  "/textures/time-roll-object-atlas-10x5.png",
  "/textures/time-roll-object-atlas-environment-10x5.png",
  "/textures/time-roll-facade-atlas-5x5.png",
];
const eraGeometry = [
  { baseRadius: 0.82, arenaUnits: 22, setPieceTopRatio: 2.14 * 1.95 },
  { baseRadius: 1.48, arenaUnits: 23, setPieceTopRatio: 2.71 * 1.95 },
  { baseRadius: 2.72, arenaUnits: 24, setPieceTopRatio: 1.195 * 1.95 },
  { baseRadius: 4.95, arenaUnits: 25, setPieceTopRatio: 3.45 * 1.95 },
  { baseRadius: 8.9, arenaUnits: 26, setPieceTopRatio: 3.2 * 1.95 },
];
await mkdir(outputDir, { recursive: true });

const errors = [];
const checks = [];
const observations = {};
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

async function readState(page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "render_game_to_text should return game state");
  return JSON.parse(raw);
}

async function readProgress(page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), saveKey);
  assert.ok(raw, "progress should be saved to localStorage");
  return JSON.parse(raw);
}

async function callTestHook(page, name, ...args) {
  return page.evaluate(
    ([hookName, hookArgs]) => {
      const hook = window.__timeRollTest?.[hookName];
      if (typeof hook !== "function") throw new Error(`missing __timeRollTest.${hookName}`);
      return hook(...hookArgs);
    },
    [name, args],
  );
}

async function expectPressed(page, accessibleName, expected) {
  const pressed = await page.getByRole("button", { name: accessibleName }).getAttribute("aria-pressed");
  assert.equal(pressed, String(expected), `${accessibleName} aria-pressed should be ${expected}`);
}

async function prepareStorage(page, value) {
  await page.addInitScript(
    ([key, storedValue]) => {
      const seedKey = `${key}:e2e-seeded`;
      if (window.sessionStorage.getItem(seedKey) === "1") return;
      window.sessionStorage.setItem(seedKey, "1");
      if (storedValue === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, storedValue);
      }
    },
    [saveKey, value === null ? null : JSON.stringify(value)],
  );
}

async function installAudioProbe(page) {
  await page.addInitScript(() => {
    window.__audioProbe = { plays: 0, pauses: 0, lastSrc: "" };
    const originalPlay = HTMLMediaElement.prototype.play;
    const originalPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function patchedPlay() {
      window.__audioProbe.plays += 1;
      window.__audioProbe.lastSrc = this.currentSrc || this.getAttribute("src") || "";
      if (window.__timeRollUseNativePlay) return originalPlay.call(this);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function patchedPause() {
      window.__audioProbe.pauses += 1;
      return originalPause.call(this);
    };
  });
}

function findOversizedItem(state) {
  const item = state.nearby
    .filter((entry) => !entry.special && !entry.collectible)
    .sort((a, b) => a.requiredRadius - b.requiredRadius)[0];
  assert.ok(item, `expected an oversized non-boss item near player; nearby=${JSON.stringify(state.nearby)}`);
  return item;
}

async function collectNaturalEraOneGrowth(page) {
  const tiers = [];
  const collectedIds = [];
  let bossUnlockedAt = null;
  let state = await readState(page);

  tiers.push(state.player.growthTier);
  for (let pass = 0; pass < 20; pass += 1) {
    let collectedThisPass = 0;

    for (let id = 0; id <= 97; id += 1) {
      if (await callTestHook(page, "collectItem", id)) {
        collectedThisPass += 1;
        collectedIds.push(id);
        state = await readState(page);
        if (tiers.at(-1) !== state.player.growthTier) tiers.push(state.player.growthTier);
        if (state.goal.bossReady && bossUnlockedAt === null) bossUnlockedAt = collectedIds.length;
        if (state.goal.bossReady && state.goal.bossTarget?.collectible) {
          return { state, tiers, collectedIds, bossUnlockedAt, passes: pass + 1 };
        }
      }
    }

    state = await readState(page);
    if (tiers.at(-1) !== state.player.growthTier) tiers.push(state.player.growthTier);
    if (state.goal.bossReady && bossUnlockedAt === null) bossUnlockedAt = collectedIds.length;
    if (state.goal.bossReady && state.goal.bossTarget?.collectible) {
      return { state, tiers, collectedIds, bossUnlockedAt, passes: pass + 1 };
    }
    if (collectedThisPass === 0) break;
  }

  return { state, tiers, collectedIds, bossUnlockedAt, passes: 20 };
}

function trackErrors(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${String(error)}`));
}

function outputPath(filename) {
  return new URL(filename, outputDir).pathname;
}

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function requireTelemetryObject(state, fieldName) {
  const value = state[fieldName];
  assert.ok(
    value && typeof value === "object",
    `render_game_to_text should expose ${fieldName} telemetry`,
  );
  return value;
}

function requireTelemetryBoolean(source, fieldName, ownerName) {
  assert.equal(
    typeof source[fieldName],
    "boolean",
    `${ownerName}.${fieldName} should be a boolean telemetry field`,
  );
  return source[fieldName];
}

function requirePlayerRoll(state) {
  const roll = state.player?.roll;
  assert.ok(
    roll && typeof roll === "object",
    "render_game_to_text should expose player.roll telemetry",
  );
  const x = Number(roll.x);
  const z = Number(roll.z);
  const deltaX = Number(roll.deltaX);
  const deltaZ = Number(roll.deltaZ);
  assert.ok(
    Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(deltaX) && Number.isFinite(deltaZ),
    `player.roll should expose numeric x/z and deltaX/deltaZ values; roll=${JSON.stringify(roll)}`,
  );
  return { x, z, deltaX, deltaZ };
}

function assertMarkerTelemetry(state, label) {
  const markers = requireTelemetryObject(state, "collectionMarkers");
  assert.equal(
    markers.count,
    markers.targetIds.length,
    `${label} marker count should match targetIds; markers=${JSON.stringify(markers)}`,
  );
  assert.ok(
    markers.count <= markers.maxTargets,
    `${label} markers should respect target cap; markers=${JSON.stringify(markers)}`,
  );
  assert.ok(
    Array.isArray(markers.visibleCollectibleIds),
    `${label} markers should expose visible collectible ids; markers=${JSON.stringify(markers)}`,
  );
  const nearestVisibleCollectibleIds = markers.visibleCollectibleIds.slice(0, markers.maxTargets);
  assert.deepEqual(
    markers.targetIds,
    nearestVisibleCollectibleIds,
    `${label} markers should target only nearest visible collectible objects; markers=${JSON.stringify(markers)}`,
  );
  assert.equal(
    markers.targets.every((entry) => entry.collectible === true),
    true,
    `${label} marker targets should all be collectible; markers=${JSON.stringify(markers)}`,
  );
  return markers;
}

function assertRollingCue(state, expected, label) {
  const cue = requireTelemetryObject(state, "rollingCue");
  assert.equal(cue.active, expected.active, `${label} rolling cue active mismatch; cue=${JSON.stringify(cue)}`);
  if (expected.reason) {
    assert.equal(cue.reason, expected.reason, `${label} rolling cue reason mismatch; cue=${JSON.stringify(cue)}`);
  }
  if (expected.active) {
    assert.ok(cue.speed > 0, `${label} active cue should require real velocity; cue=${JSON.stringify(cue)}`);
    assert.ok(cue.rollMagnitude > 0, `${label} active cue should require real roll delta; cue=${JSON.stringify(cue)}`);
  }
  return cue;
}

function feedbackIndicatesSuccess(feedback) {
  return feedback.success === true;
}

function feedbackHasParticles(feedback) {
  return Number(feedback.particleCount) > 0;
}

function feedbackHasCallout(feedback) {
  const callout = feedback.callout;
  return typeof callout === "string" && callout.trim().length > 0;
}

function assertMobileRenderBudget(renderStats, label) {
  assert.ok(renderStats, `${label} should expose renderStats`);
  assert.ok(
    renderStats.drawCalls <= MOBILE_DRAW_CALL_CAP,
    `${label} mobile drawCalls=${renderStats.drawCalls}`,
  );
  assert.ok(
    renderStats.transparentCalls <= MOBILE_TRANSPARENT_CALL_CAP,
    `${label} mobile transparentCalls=${renderStats.transparentCalls}`,
  );
}

function assertEndCondition(state, expectedPhases, label) {
  const endCondition = requireTelemetryObject(state, "endCondition");
  assert.equal(
    typeof endCondition.phase,
    "string",
    `${label} endCondition should expose a string phase; actual=${JSON.stringify(endCondition)}`,
  );
  assert.ok(
    expectedPhases.includes(endCondition.phase),
    `${label} should expose endCondition phase ${expectedPhases.join(" or ")}; actual=${JSON.stringify(endCondition)}`,
  );
  assert.ok(
    typeof endCondition.label === "string",
    `${label} endCondition should expose stable HUD copy; actual=${JSON.stringify(endCondition)}`,
  );
  return endCondition;
}

async function assertOverlayMessaging(page, mode, expectedPatterns, label) {
  const state = await readState(page);
  assert.equal(state.mode, mode, `${label} should reach ${mode}`);
  const text = await page.locator("body").innerText();
  for (const pattern of expectedPatterns) {
    assert.match(text, pattern, `${label} ${mode} overlay should include ${pattern}`);
  }
}

async function assertPickupHasSingleLiveAnnouncement(page) {
  await page.locator(".pickup-callout[aria-hidden='true']").waitFor({ state: "visible" });
  await page.locator(".pickup-callout-copy.sr-only").waitFor({ state: "attached" });
  assert.equal(
    await page.locator("[aria-live='polite']").count(),
    1,
    "pickup should have exactly one polite live region",
  );
  assert.equal(
    await page.locator(".game-message[role='status'][aria-live='polite']").count(),
    1,
    "visible pickup status should be the polite live announcement",
  );
  assert.equal(
    await page.locator(".pickup-callout[aria-live], .pickup-callout-copy[aria-live]").count(),
    0,
    "visual pickup callout and sr-only pickup copy should not create extra live regions",
  );
  assert.match(
    await page.locator(".pickup-callout-copy.sr-only").textContent(),
    /수집 성공!/,
    "sr-only pickup copy should duplicate the pickup success text without being live",
  );
}

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function readRequiredRect(page, selector, label) {
  const rect = await page.locator(selector).first().evaluate((element) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  });
  assert.ok(rect.width > 0 && rect.height > 0, `${label} should have visible dimensions; rect=${JSON.stringify(rect)}`);
  return rect;
}

async function assertMobileAudioHudLayout(page, viewport, label) {
  const bgmButton = page.getByRole("button", { name: "배경음악 끄기" });
  const sfxButton = page.getByRole("button", { name: "효과음 끄기" });
  await bgmButton.waitFor({ state: "visible" });
  await sfxButton.waitFor({ state: "visible" });

  assert.match(await bgmButton.innerText(), /음악\s*켬/, `${label} should show visible Korean BGM state`);
  assert.match(await sfxButton.innerText(), /효과\s*켬/, `${label} should show visible Korean SFX state`);

  const hudRect = await readRequiredRect(page, ".hud-actions", `${label} HUD actions`);
  const hudTopRect = await readRequiredRect(page, ".hud-top", `${label} top HUD`);
  const eraTitleRect = await readRequiredRect(page, ".era-card strong", `${label} era title`);
  const sizeCardRect = await readRequiredRect(page, ".size-card", `${label} size card`);
  const themeStripRect = await readRequiredRect(page, ".theme-strip", `${label} theme strip`);
  assert.equal(Math.round(hudRect.left), viewport.width - 6 - 92, `${label} HUD actions should sit 6px from right`);
  assert.equal(Math.round(hudRect.top), 202, `${label} HUD actions should sit below top HUD at 202px`);
  assert.equal(Math.round(hudRect.width), 92, `${label} HUD actions should be a 2x2 44px target grid with one 4px gap`);
  assert.equal(Math.round(hudRect.height), 92, `${label} HUD actions should be a 2x2 44px target grid with one 4px gap`);
  assert.equal(Math.round(hudTopRect.left), 6, `${label} top HUD should reclaim the left safe margin`);
  assert.equal(Math.round(hudTopRect.width), viewport.width - 12, `${label} top HUD should reclaim former control space`);
  assert.ok(eraTitleRect.width >= Math.min(118, viewport.width * 0.36), `${label} era title should keep readable width; rect=${JSON.stringify(eraTitleRect)}`);
  assert.ok(sizeCardRect.right <= viewport.width - 6 + 1, `${label} size card should remain inside the right edge; rect=${JSON.stringify(sizeCardRect)}`);
  assert.ok(themeStripRect.right <= viewport.width - 6 + 1, `${label} theme strip should fit inside viewport; rect=${JSON.stringify(themeStripRect)}`);
  assert.equal(
    rectsIntersect(hudRect, hudTopRect),
    false,
    `${label} HUD actions should not intersect top HUD; hud=${JSON.stringify(hudRect)} top=${JSON.stringify(hudTopRect)}`,
  );

  for (const button of await page.locator(".hud-actions .icon-button").all()) {
    const box = await button.boundingBox();
    assert.ok(box, `${label} HUD action should have a bounding box`);
    assert.ok(box.width >= 44 && box.height >= 44, `${label} HUD target should be at least 44x44; box=${JSON.stringify(box)}`);
  }
}

async function assertMobilePickupHidesAudioHud(page, viewport, label) {
  await page.locator(".pickup-callout[aria-hidden='true']").waitFor({ state: "visible" });
  await page.locator(".game-message[role='status']").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".game-shell").getAttribute("data-pickup-feedback-active"),
    "true",
    `${label} shell should expose active pickup feedback state`,
  );
  assert.equal(
    await page.locator(".hud-actions").isVisible(),
    false,
    `${label} HUD actions should be hidden while pickup callout is active`,
  );
  const hudStyle = await page.locator(".hud-actions").evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
    };
  });
  assert.deepEqual(
    hudStyle,
    { visibility: "hidden", opacity: "0", pointerEvents: "none" },
    `${label} hidden HUD actions should not receive input; style=${JSON.stringify(hudStyle)}`,
  );

  const messageRect = await readRequiredRect(page, ".game-message[role='status']", `${label} game message`);
  const calloutRect = await readRequiredRect(page, ".pickup-callout[aria-hidden='true']", `${label} pickup callout`);
  assert.equal(Math.round(messageRect.left), 6, `${label} message should pin to the left safe margin`);
  assert.ok(
    messageRect.right <= viewport.width - 112 + 6 + 1,
    `${label} message should reserve the right-side action grid; message=${JSON.stringify(messageRect)}`,
  );
  assert.ok(calloutRect.left >= 0 && calloutRect.right <= viewport.width, `${label} pickup callout should fit viewport; rect=${JSON.stringify(calloutRect)}`);
  assert.match(await page.locator("body").innerText(), /수집 성공!/, `${label} pickup callout/message should show success text`);
}

async function captureCanvas(page, filename) {
  const path = outputPath(filename);
  const canvas = page.locator("canvas");
  await canvas.waitFor({ state: "visible" });
  await canvas.screenshot({ path });
  const metadata = await sharp(path).metadata();
  const statistics = await sharp(path).stats();
  assert.ok((metadata.width ?? 0) >= 640, `${filename} should have a useful width`);
  assert.ok((metadata.height ?? 0) >= 360, `${filename} should have a useful height`);
  assert.ok(
    statistics.channels.slice(0, 3).some((channel) => channel.stdev > 8),
    `${filename} should contain a non-blank rendered scene`,
  );
  return path;
}

async function waitForVisualAssets(page) {
  await page.waitForFunction(
    (expectedPaths) => {
      const loadedPaths = new Set(
        performance
          .getEntriesByType("resource")
          .filter((entry) => entry.name.includes("/textures/time-roll-") && entry.responseEnd > 0)
          .map((entry) => new URL(entry.name).pathname),
      );
      return expectedPaths.every((path) => loadedPaths.has(path));
    },
    expectedVisualAssetPaths,
    { timeout: 10_000 },
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

async function imageDifference(leftPath, rightPath) {
  const [left, right] = await Promise.all([
    sharp(leftPath).resize(160, 90, { fit: "fill" }).removeAlpha().raw().toBuffer(),
    sharp(rightPath).resize(160, 90, { fit: "fill" }).removeAlpha().raw().toBuffer(),
  ]);
  assert.equal(left.length, right.length);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference += Math.abs(left[index] - right[index]);
  }
  return Number((difference / left.length).toFixed(2));
}

async function countVividMagentaPixels(path) {
  const { data } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let index = 0; index < data.length; index += 3) {
    if (data[index] >= 235 && data[index + 1] <= 35 && data[index + 2] >= 235) {
      count += 1;
    }
  }
  return count;
}

function projectSetPieceVerticalSpan(camera, worldZ, topY, viewportHeight) {
  const forwardY = camera.target[1] - camera.eye[1];
  const forwardZ = camera.target[2] - camera.eye[2];
  const forwardLength = Math.hypot(forwardY, forwardZ);
  const normalizedForwardY = forwardY / forwardLength;
  const normalizedForwardZ = forwardZ / forwardLength;
  const upY = -normalizedForwardZ;
  const upZ = normalizedForwardY;
  const tangent = Math.tan((camera.fovDegrees * Math.PI) / 360);
  const projectY = (worldY) => {
    const relativeY = worldY - camera.eye[1];
    const relativeZ = worldZ - camera.eye[2];
    const depth = relativeY * normalizedForwardY + relativeZ * normalizedForwardZ;
    const vertical = relativeY * upY + relativeZ * upZ;
    const normalizedY = vertical / (depth * tangent);
    return ((1 - normalizedY) * viewportHeight) / 2;
  };
  const projectedTop = projectY(topY);
  const projectedBase = projectY(0);
  const visibleTop = Math.max(0, Math.min(viewportHeight, projectedTop));
  const visibleBase = Math.max(0, Math.min(viewportHeight, projectedBase));
  return {
    topPx: Number(projectedTop.toFixed(1)),
    basePx: Number(projectedBase.toFixed(1)),
    visibleHeightPx: Number(Math.abs(visibleBase - visibleTop).toFixed(1)),
  };
}

function escapeSvgText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function buildContactSheet(cards, filename, columns, tileWidth = 480, tileHeight = 270) {
  const labelHeight = 42;
  const rows = Math.ceil(cards.length / columns);
  const cardHeight = labelHeight + tileHeight;
  const composites = [];

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * tileWidth;
    const top = row * cardHeight;
    const image = await sharp(card.path)
      .resize(tileWidth, tileHeight, { fit: "cover" })
      .png()
      .toBuffer();
    const label = Buffer.from(
      `<svg width="${tileWidth}" height="${labelHeight}">
        <rect width="100%" height="100%" fill="#111827"/>
        <text x="18" y="28" fill="#f9fafb" font-size="20" font-family="Arial, sans-serif" font-weight="700">${escapeSvgText(card.label)}</text>
      </svg>`,
    );
    composites.push({ input: label, left, top });
    composites.push({ input: image, left, top: top + labelHeight });
  }

  const path = outputPath(filename);
  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * cardHeight,
      channels: 3,
      background: "#0b1020",
    },
  })
    .composite(composites)
    .png()
    .toFile(path);
  return path;
}

try {
  const migration = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  trackErrors(migration, "migration");
  await installAudioProbe(migration);
  await prepareStorage(migration, { bestEra: 2.8, bestSize: 12.5 });
  const bgmAsset = await migration.request.get(`${url}${bgmPath}`);
  assert.equal(bgmAsset.status(), 200, "BGM asset should be served over HTTP");
  assert.match(
    bgmAsset.headers()["content-type"] ?? "",
    /^(audio|video)\//,
    `BGM asset should have an audio/video content type; headers=${JSON.stringify(bgmAsset.headers())}`,
  );
  await migration.goto(url, { waitUntil: "domcontentloaded" });
  await migration.waitForSelector("#start-btn");
  await migration.waitForFunction(() => document.body.innerText.includes("이어서 굴리기"));
  assert.equal(await migration.getByRole("button", { name: "이어서 굴리기" }).isVisible(), true);
  assert.equal(await migration.locator(".era-node.is-unlocked").count(), 3);
  let audioState = (await readState(migration)).audio;
  assert.equal(audioState.bgmEnabled, true);
  assert.equal(audioState.sfxEnabled, true);
  assert.equal(audioState.bgmPlayingIntent, false, "intro should not request BGM autoplay");
  assert.equal(audioState.trackSrc, bgmPath);
  assert.equal(audioState.loop, true);
  assert.equal(audioState.volume, 0.14);
  assert.equal(await migration.evaluate(() => window.__audioProbe.plays), 0, "intro should not call audio.play");
  await migration.getByRole("button", { name: "이어서 굴리기" }).click();
  await migration.waitForFunction(() => window.render_game_to_text?.().includes("\"mode\":\"playing\""));
  await migration.waitForFunction(() => window.render_game_to_text && JSON.parse(window.render_game_to_text()).audio.bgmPlayingIntent === true);
  audioState = (await readState(migration)).audio;
  assert.equal(audioState.bgmPlayingIntent, true, "explicit start should request BGM playback");
  assert.ok(await migration.evaluate(() => window.__audioProbe.plays) >= 1, "explicit start should call audio.play");
  const sfxToggle = migration.getByRole("button", { name: "효과음 끄기" });
  await expectPressed(migration, "효과음 끄기", true);
  await sfxToggle.click();
  let progress = await readProgress(migration);
  assert.equal(progress.version, 3);
  assert.equal(progress.bestEra, 2);
  assert.equal(progress.bestSize, 12.5);
  assert.deepEqual(progress.eras, {});
  assert.equal(progress.bgmEnabled, true);
  assert.equal(progress.sfxEnabled, false);
  await migration.waitForFunction(() => !!document.querySelector('button[aria-label="효과음 켜기"]'));
  await expectPressed(migration, "효과음 켜기", false);
  audioState = (await readState(migration)).audio;
  assert.equal(audioState.bgmEnabled, true, "SFX off should leave BGM enabled");
  assert.equal(audioState.sfxEnabled, false);
  await migration.getByRole("button", { name: "효과음 켜기" }).click();
  await migration.waitForFunction(() => !!document.querySelector('button[aria-label="효과음 끄기"]'));
  await expectPressed(migration, "효과음 끄기", true);
  await migration.getByRole("button", { name: "배경음악 끄기" }).click();
  await migration.waitForFunction(() => !!document.querySelector('button[aria-label="배경음악 켜기"]'));
  await expectPressed(migration, "배경음악 켜기", false);
  progress = await readProgress(migration);
  assert.equal(progress.bgmEnabled, false);
  assert.equal(progress.sfxEnabled, true);
  audioState = (await readState(migration)).audio;
  assert.equal(audioState.bgmEnabled, false);
  assert.equal(audioState.sfxEnabled, true, "BGM off should leave SFX enabled");
  assert.equal(audioState.bgmPlayingIntent, false);
  await migration.reload({ waitUntil: "domcontentloaded" });
  await migration.waitForSelector("#start-btn");
  await migration.waitForFunction(() => !!document.querySelector('button[aria-label="배경음악 켜기"]'));
  assert.equal(await migration.getByRole("button", { name: "배경음악 켜기" }).isVisible(), true);
  assert.equal(await migration.getByRole("button", { name: "효과음 끄기" }).isVisible(), true);
  progress = await readProgress(migration);
  assert.equal(progress.bgmEnabled, false);
  assert.equal(progress.sfxEnabled, true);
  observations.migratedProgress = {
    version: progress.version,
    bestEra: progress.bestEra,
    bestSize: progress.bestSize,
    bgmEnabled: progress.bgmEnabled,
    sfxEnabled: progress.sfxEnabled,
    bgmAssetContentType: bgmAsset.headers()["content-type"] ?? "",
  };
  checks.push("v1 progress migrates to v3 and independent audio toggles survive reload");
  await migration.close();

  const reducedMotion = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await reducedMotion.emulateMedia({ reducedMotion: "reduce" });
  trackErrors(reducedMotion, "reduced-motion");
  await prepareStorage(reducedMotion, null);
  await reducedMotion.goto(url, { waitUntil: "domcontentloaded" });
  await reducedMotion.waitForSelector("#start-btn");
  await reducedMotion.click("#start-btn");
  await waitForVisualAssets(reducedMotion);
  let reducedState = await readState(reducedMotion);
  assert.equal(reducedState.reducedMotion, true);
  await reducedMotion.keyboard.down("ArrowUp");
  await reducedMotion.evaluate(() => window.advanceTime?.(500));
  await reducedMotion.keyboard.up("ArrowUp");
  reducedState = await readState(reducedMotion);
  assertRollingCue(reducedState, { active: false, reason: "reduced-motion" }, "reduced-motion movement");
  const reducedPickup = reducedState.nearby.find((entry) => entry.collectible && !entry.special);
  assert.ok(reducedPickup, "reduced-motion pickup FX check needs a deterministic collectible");
  await callTestHook(reducedMotion, "setRadiusRatio", (reducedPickup.requiredRadius * 1.02) / (reducedState.player.radius / reducedState.player.growthRatio));
  await callTestHook(reducedMotion, "warpToItem", reducedPickup.id);
  assert.equal(await callTestHook(reducedMotion, "collectItem", reducedPickup.id), true);
  reducedState = await readState(reducedMotion);
  const reducedFeedback = requireTelemetryObject(reducedState, "feedback");
  assert.equal(reducedFeedback.success, true, `reduced-motion pickup should still announce success; feedback=${JSON.stringify(reducedFeedback)}`);
  assert.equal(reducedFeedback.successFxActive, false, `reduced-motion pickup should suppress world FX telemetry; feedback=${JSON.stringify(reducedFeedback)}`);
  assert.equal(feedbackHasParticles(reducedFeedback), false, `reduced-motion pickup should suppress particles; feedback=${JSON.stringify(reducedFeedback)}`);
  assert.match(await reducedMotion.locator("body").innerText(), /수집 성공!/, "reduced-motion pickup should keep visible success UI");
  checks.push("reduced-motion suppresses rolling cue and pickup world FX while keeping success UI");
  await reducedMotion.close();

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  trackErrors(desktop, "desktop");
  await prepareStorage(desktop, null);
  await desktop.goto(url, { waitUntil: "domcontentloaded" });
  await desktop.waitForSelector("#start-btn");
  await desktop.screenshot({ path: new URL("desktop-intro.png", outputDir).pathname, fullPage: true });
  assert.equal(await desktop.locator("canvas").count(), 1);
  assert.match(await desktop.locator("body").innerText(), /로봇 토리/);
  assert.match(await desktop.locator("body").innerText(), /시간동력핵/);
  assert.match(await desktop.locator("body").innerText(), /데굴데굴\s*시간공작소/);
  assert.equal(await desktop.getByRole("button", { name: "처음 시작" }).isVisible(), true);
  checks.push("landing contains robot Tori story and title CTA");

  await desktop.click("#start-btn");
  await waitForVisualAssets(desktop);
  let state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.era.index, 1);
  assert.equal(state.player.growthTier, "tiny");
  assert.ok(state.player.growthRatio < 0.2);
  const openingMarkers = assertMarkerTelemetry(state, "desktop opening");
  assert.equal(openingMarkers.maxTargets, 3);
  assertRollingCue(state, { active: false, reason: "no-velocity" }, "desktop opening rest");
  await desktop.keyboard.down("ArrowUp");
  await desktop.evaluate(() => window.advanceTime?.(700));
  await desktop.keyboard.up("ArrowUp");
  state = await readState(desktop);
  const movingCue = assertRollingCue(state, { active: true, reason: "moving" }, "desktop keyboard movement");
  const movingRoll = requirePlayerRoll(state);
  assert.ok(Math.hypot(movingRoll.deltaX, movingRoll.deltaZ) > 0, `desktop movement should expose roll deltas; roll=${JSON.stringify(movingRoll)}`);
  await desktop.evaluate(() => window.advanceTime?.(1800));
  state = await readState(desktop);
  assertRollingCue(state, { active: false }, "desktop post-movement rest");
  observations.rollingCue = {
    desktopMoving: movingCue,
    desktopRest: state.rollingCue,
  };
  checks.push("rolling cue activates only from real velocity plus roll deltas and clears at rest");
  await desktop.screenshot({ path: new URL("desktop-playing-start.png", outputDir).pathname, fullPage: true });
  let endCondition = assertEndCondition(state, ["collect"], "desktop opening HUD");
  assert.match(await desktop.locator("body").innerText(), /게임 종료 조건/, "desktop HUD should show the explicit end condition");
  assert.ok(
    JSON.stringify(endCondition).includes(String(state.goal.required - state.goal.collected)) ||
      JSON.stringify(endCondition).includes(state.goal.bossTarget?.name ?? ""),
    `desktop opening endCondition should describe collect progress or boss target; actual=${JSON.stringify(endCondition)}`,
  );
  const debugRobot = requireTelemetryObject(state, "debugRobot");
  assert.equal(requireTelemetryBoolean(debugRobot, "behindBall", "debugRobot"), true);
  assert.equal(requireTelemetryBoolean(debugRobot, "handsAtContact", "debugRobot"), true);
  await captureCanvas(desktop, "robot-ball-contact-start.png");
  observations.robotBallContact = {
    debugRobot,
    screenshot: "robot-ball-contact-start.png",
  };
  checks.push("robot telemetry keeps Tori behind the time ball with hands at contact");

  const robotHeadingCases = [
    { label: "Front 0 deg", slug: "front-0deg", heading: 0 },
    { label: "Right +90 deg", slug: "right-plus90deg", heading: Math.PI / 2 },
    { label: "Left -90 deg", slug: "left-minus90deg", heading: -Math.PI / 2 },
    { label: "Back 180 deg", slug: "back-180deg", heading: Math.PI },
  ];
  const robotHeadingCards = [];
  const robotHeadingStates = [];
  for (const headingCase of robotHeadingCases) {
    await callTestHook(desktop, "setCameraHeading", headingCase.heading);
    state = await readState(desktop);
    assert.ok(
      angleDistance(state.camera.heading, headingCase.heading) <= 0.006,
      `${headingCase.label} should set camera heading exactly; actual=${state.camera.heading}`,
    );
    const path = await captureCanvas(desktop, `robot-heading-${headingCase.slug}.png`);
    robotHeadingCards.push({ label: headingCase.label, path });
    robotHeadingStates.push({
      label: headingCase.label,
      requested: Number(headingCase.heading.toFixed(3)),
      actual: state.camera.heading,
      camera: state.camera,
      renderStats: state.renderStats,
      screenshot: `robot-heading-${headingCase.slug}.png`,
    });
  }
  const robotHeadingDifferences = [];
  for (let index = 1; index < robotHeadingCards.length; index += 1) {
    const difference = await imageDifference(robotHeadingCards[0].path, robotHeadingCards[index].path);
    assert.ok(difference >= 2, `${robotHeadingCards[index].label} should render a visibly different view`);
    robotHeadingDifferences.push({
      comparison: `${robotHeadingCards[0].label} vs ${robotHeadingCards[index].label}`,
      meanAbsolutePixelDifference: difference,
    });
  }
  await buildContactSheet(robotHeadingCards, "robot-heading-contact-sheet.png", 2, 640, 360);
  observations.robotHeadingRegression = {
    headings: robotHeadingStates,
    differences: robotHeadingDifferences,
    contactSheet: "robot-heading-contact-sheet.png",
  };
  checks.push("robot renders at exact 0, +90, -90, and 180 degree headings");

  await callTestHook(desktop, "startEra", 0);
  await callTestHook(desktop, "setCameraHeading", 0);
  state = await readState(desktop);
  const blockedScoreBefore = state.score;
  const oversized = findOversizedItem(state);
  assert.equal(
    state.collectionMarkers.targetIds.includes(oversized.id),
    false,
    `oversized item should be excluded from collectible markers before growth; markers=${JSON.stringify(state.collectionMarkers)}`,
  );
  assert.equal(await callTestHook(desktop, "warpToItem", oversized.id), true);
  assert.equal(await callTestHook(desktop, "collectItem", oversized.id), false);
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.lastCollection, "");
  assert.equal(state.score, blockedScoreBefore);
  await desktop.evaluate(() => window.advanceTime?.(100));
  state = await readState(desktop);
  const blockedFeedback = requireTelemetryObject(state, "feedback");
  assert.equal(feedbackIndicatesSuccess(blockedFeedback), false, `blocked collision should not expose success feedback; feedback=${JSON.stringify(blockedFeedback)}`);
  assert.equal(feedbackHasParticles(blockedFeedback), false, `blocked collision should not expose success particles; feedback=${JSON.stringify(blockedFeedback)}`);
  assert.equal(state.score, blockedScoreBefore);
  const pushedOversized = state.nearby.find((entry) => entry.id === oversized.id);
  assert.ok(pushedOversized, "oversized collision target should remain in the world");
  const oversizedCollisionDistance = state.player.radius + pushedOversized.size * 0.58;
  assert.ok(
    pushedOversized.distance >= oversizedCollisionDistance - 0.03,
    `oversized item should push clear of the player; distance=${pushedOversized.distance}, threshold=${oversizedCollisionDistance}`,
  );
  observations.oversizedCollisionSeparation = {
    item: pushedOversized.name,
    distance: pushedOversized.distance,
    collisionDistance: Number(oversizedCollisionDistance.toFixed(3)),
    blockedCollision: state.blockedCollision,
    feedback: blockedFeedback,
  };
  checks.push("oversized collision pushes clear without success FX, particles, or score");
  checks.push("starts tiny and blocks an oversized item");

  await callTestHook(desktop, "setRadiusRatio", (oversized.requiredRadius * 1.02) / (state.player.radius / state.player.growthRatio));
  state = await readState(desktop);
  assertMarkerTelemetry(state, "desktop oversized after growth");
  assert.equal(
    state.collectionMarkers.targetIds.includes(oversized.id),
    true,
    `same oversized item should receive a marker once collectible; markers=${JSON.stringify(state.collectionMarkers)}`,
  );
  assert.equal(await callTestHook(desktop, "collectItem", oversized.id), true);
  state = await readState(desktop);
  const successFeedback = requireTelemetryObject(state, "feedback");
  assert.equal(state.lastCollection.startsWith(oversized.name), true);
  assert.equal(feedbackIndicatesSuccess(successFeedback), true, `successful pickup should expose success feedback; feedback=${JSON.stringify(successFeedback)}`);
  assert.equal(feedbackHasParticles(successFeedback), true, `successful pickup should expose pickup particles; feedback=${JSON.stringify(successFeedback)}`);
  assert.equal(feedbackHasCallout(successFeedback), true, `successful pickup should expose a callout; feedback=${JSON.stringify(successFeedback)}`);
  assert.match(await desktop.locator("body").innerText(), /수집 성공!/, "successful pickup should show a visible success callout");
  await assertPickupHasSingleLiveAnnouncement(desktop);
  assert.ok(["small", "medium", "large", "monument"].includes(state.player.growthTier));
  await desktop.screenshot({ path: new URL("desktop-pickup-success.png", outputDir).pathname, fullPage: true });
  await desktop.evaluate(() => window.advanceTime?.(2600));
  state = await readState(desktop);
  const clearedFeedback = requireTelemetryObject(state, "feedback");
  assert.equal(feedbackIndicatesSuccess(clearedFeedback), false, `pickup success feedback should clear after its lifetime; feedback=${JSON.stringify(clearedFeedback)}`);
  assert.equal(feedbackHasParticles(clearedFeedback), false, `pickup particles should clear after their lifetime; feedback=${JSON.stringify(clearedFeedback)}`);
  checks.push("same oversized item collects after deterministic size setup and success FX clears");

  await callTestHook(desktop, "startEra", 0);
  state = await readState(desktop);
  const boss = state.goal.bossTarget;
  assert.ok(boss, "first era should expose a boss target");
  await callTestHook(desktop, "setRadiusRatio", 0.75);
  assert.equal(await callTestHook(desktop, "collectItem", boss.id), false);
  state = await readState(desktop);
  assert.equal(state.goal.bossReady, false);
  assert.equal(state.mode, "playing");
  await callTestHook(desktop, "unlockBoss");
  await callTestHook(desktop, "setRadiusRatio", 0.2);
  await callTestHook(desktop, "warpToItem", boss.id);
  state = await readState(desktop);
  assert.equal(state.goal.bossReady, true);
  assertEndCondition(state, ["boss"], "desktop boss HUD");
  assert.equal(state.goal.bossTarget.collectible, false);
  assert.equal(
    state.collectionMarkers.targetIds.includes(boss.id),
    false,
    `boss should not receive a marker until size rule allows collection; markers=${JSON.stringify(state.collectionMarkers)}`,
  );
  assert.equal(await callTestHook(desktop, "collectItem", boss.id), false);
  assert.equal((await readState(desktop)).mode, "playing");
  await callTestHook(desktop, "setRadiusRatio", (state.goal.bossTarget.requiredRadius * 1.02) / (state.player.radius / state.player.growthRatio));
  await callTestHook(desktop, "warpToItem", boss.id);
  state = await readState(desktop);
  assert.equal(state.goal.bossTarget.collectible, true);
  assert.equal(
    state.collectionMarkers.targetIds.includes(boss.id),
    true,
    `collectible boss should receive a marker; markers=${JSON.stringify(state.collectionMarkers)}`,
  );
  assert.equal(await callTestHook(desktop, "collectItem", boss.id), true);
  state = await readState(desktop);
  assert.equal(state.mode, "eraClear");
  await assertOverlayMessaging(desktop, "eraClear", [/거대 코어/, /시대 점수/, /다음 시대로/], "desktop");
  assert.equal(state.goal.bossTarget.collected, true);
  assert.ok(state.goal.collected >= state.goal.required);
  await desktop.screenshot({ path: new URL("desktop-era-clear.png", outputDir).pathname, fullPage: true });
  checks.push("boss stays locked until focus goal and adequate size, and is required for era clear");

  await callTestHook(desktop, "startEra", 0);
  const natural = await collectNaturalEraOneGrowth(desktop);
  state = natural.state;
  assert.deepEqual(natural.tiers.slice(0, 4), ["tiny", "small", "medium", "large"]);
  assert.ok(
    natural.tiers.includes("monument") || natural.tiers.at(-1) === "large",
    `expected natural growth through large or monument; tiers=${natural.tiers.join(" -> ")}`,
  );
  assert.ok(natural.collectedIds.length >= state.goal.required);
  assert.ok(natural.bossUnlockedAt !== null, "focus goal should naturally unlock boss");
  assert.equal(state.goal.bossReady, true);
  assert.equal(state.goal.bossTarget.collectible, true);
  assert.ok(state.player.radius >= state.goal.bossTarget.requiredRadius);
  assert.equal(await callTestHook(desktop, "collectItem", state.goal.bossTarget.id), true);
  state = await readState(desktop);
  assert.equal(state.mode, "eraClear");
  assert.equal(state.goal.bossTarget.collected, true);
  assert.ok(state.goal.collected >= state.goal.required);
  progress = await readProgress(desktop);
  assert.equal(progress.version, 3);
  assert.equal(progress.bestEra, 1);
  assert.equal(progress.eras["0"].completed, true);
  assert.equal(progress.eras["0"].bestScore, state.eraScore);
  assert.equal(progress.eras["0"].maxCombo, state.maxCombo);
  assert.match(progress.eras["0"].bestRank, /^[SAB]$/);
  assert.equal(progress.totalScore, progress.eras["0"].bestScore);
  observations.naturalEraOne = {
    tiers: natural.tiers,
    collectedIds: natural.collectedIds.length,
    bossUnlockedAt: natural.bossUnlockedAt,
    score: state.eraScore,
    maxCombo: state.maxCombo,
    bestRank: progress.eras["0"].bestRank,
  };
  checks.push(`natural era 1 growth ladder reaches boss threshold in ${natural.passes} passes`);

  await desktop.getByRole("button", { name: "다음 시대로" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.era.index, 2);
  progress = await readProgress(desktop);
  assert.equal(progress.bestEra, 1);
  assert.equal(progress.eras["0"].completed, true);
  checks.push("v3 era clear records per-era bests and unlocks next era");

  await desktop.getByRole("button", { name: "게임 잠시 멈추기" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "paused");
  await desktop.getByRole("button", { name: "계속 굴리기" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  checks.push("pause and resume");

  await callTestHook(desktop, "startEra", 0);
  await desktop.evaluate(() => window.advanceTime?.(200000));
  await assertOverlayMessaging(desktop, "timeUp", [/시간 종료/, /조금만 더 굴려볼까요/, /이 시대 다시 도전/], "desktop");
  await desktop.screenshot({ path: new URL("desktop-time-up.png", outputDir).pathname, fullPage: true });
  checks.push("desktop time-up overlay explains current record and retry action");

  await callTestHook(desktop, "startEra", 1);
  await callTestHook(desktop, "setCameraHeading", 0);
  state = await readState(desktop);
  const idleCamera = state.camera;
  const rollBeforeMove = requirePlayerRoll(state);
  await desktop.keyboard.down("ArrowRight");
  await desktop.keyboard.down("Shift");
  await desktop.evaluate(() => window.advanceTime?.(900));
  await desktop.keyboard.up("Shift");
  await desktop.keyboard.up("ArrowRight");
  state = await readState(desktop);
  const rollAfterMove = requirePlayerRoll(state);
  const rollDelta = Math.hypot(rollAfterMove.x - rollBeforeMove.x, rollAfterMove.z - rollBeforeMove.z);
  assert.ok(rollDelta > 0.05, `player.roll should change after movement; before=${JSON.stringify(rollBeforeMove)} after=${JSON.stringify(rollAfterMove)}`);
  assert.ok(state.player.x > 0.1);
  assert.ok(state.camera.speed01 > 0.08, `dynamic camera should register movement speed; speed01=${state.camera.speed01}`);
  const dynamicCameraDelta = {
    heading: Number(angleDistance(state.camera.heading, idleCamera.heading).toFixed(3)),
    bank: Number(Math.abs(state.camera.bank - idleCamera.bank).toFixed(3)),
    fovDegrees: Number(Math.abs(state.camera.fovDegrees - idleCamera.fovDegrees).toFixed(1)),
  };
  assert.ok(
    dynamicCameraDelta.heading > 0.03 || dynamicCameraDelta.bank > 0.004 || dynamicCameraDelta.fovDegrees > 0.5,
    `dynamic camera should change heading, bank, or FOV while moving; delta=${JSON.stringify(dynamicCameraDelta)}`,
  );
  const playerFraming = state.playerFraming;
  assert.ok(
    state.player.radius >= 0.25 && state.player.growthRatio >= 0.18,
    `dynamic camera framing should exercise a meaningfully grown time ball; player=${JSON.stringify(state.player)}`,
  );
  assert.ok(
    playerFraming?.ballBounds && playerFraming?.viewport,
    `dynamic camera framing should expose actual time-ball projection; framing=${JSON.stringify(playerFraming)}`,
  );
  assert.ok(
    playerFraming.radiusPx > 20 && playerFraming.center,
    `dynamic camera framing should describe the visible time ball, not background geometry; framing=${JSON.stringify(playerFraming)}`,
  );
  const framingTolerancePx = 1;
  assert.ok(
    playerFraming.ballBounds.left >= -framingTolerancePx &&
      playerFraming.ballBounds.top >= -framingTolerancePx &&
      playerFraming.ballBounds.right <= playerFraming.viewport.width + framingTolerancePx &&
      playerFraming.ballBounds.bottom <= playerFraming.viewport.height + framingTolerancePx,
    `grown time ball should remain fully inside gameplay viewport during boosted dynamic camera; framing=${JSON.stringify(playerFraming)} camera=${JSON.stringify(state.camera)}`,
  );
  await captureCanvas(desktop, "desktop-playing-dynamic.png");
  observations.dynamicCameraRegression = {
    idleCamera,
    movingCamera: state.camera,
    delta: dynamicCameraDelta,
    rollBeforeMove,
    rollAfterMove,
    rollDelta: Number(rollDelta.toFixed(3)),
    boostAfterMove: state.boost,
    playerFraming,
    screenshot: "desktop-playing-dynamic.png",
  };
  await desktop.keyboard.press("KeyR");
  state = await readState(desktop);
  assert.equal(state.era.index, 2);
  assert.equal(state.player.x, 0);
  assert.equal(state.player.z, 0);
  checks.push("movement, boost-responsive dynamic camera, and era retry");

  const eraLandmarkLabels = [
    "Era 1 Manufacturing",
    "Era 2 Construction",
    "Era 3 Transport",
    "Era 4 Communication",
    "Era 5 Life",
  ];
  const eraLandmarkCards = [];
  const eraLandmarkStates = [];
  for (let eraIndex = 0; eraIndex < 5; eraIndex += 1) {
    await callTestHook(desktop, "startEra", eraIndex);
    await callTestHook(desktop, "setCameraHeading", 0);
    state = await readState(desktop);
    assert.equal(state.era.index, eraIndex + 1);
    assert.ok(angleDistance(state.camera.heading, 0) <= 0.006);
    const screenshot = `era-landmark-${String(eraIndex + 1).padStart(2, "0")}.png`;
    const path = await captureCanvas(desktop, screenshot);
    eraLandmarkCards.push({ label: eraLandmarkLabels[eraIndex], path });
    eraLandmarkStates.push({
      label: eraLandmarkLabels[eraIndex],
      era: state.era,
      camera: state.camera,
      renderStats: state.renderStats,
      objectField: state.objectField,
      screenshot,
    });
  }
  const eraLandmarkDifferences = [];
  for (let index = 1; index < eraLandmarkCards.length; index += 1) {
    const difference = await imageDifference(eraLandmarkCards[index - 1].path, eraLandmarkCards[index].path);
    assert.ok(difference >= 2, `${eraLandmarkCards[index].label} should be visually distinct`);
    eraLandmarkDifferences.push({
      comparison: `${eraLandmarkCards[index - 1].label} vs ${eraLandmarkCards[index].label}`,
      meanAbsolutePixelDifference: difference,
    });
  }
  await buildContactSheet(eraLandmarkCards, "era-landmark-contact-sheet.png", 3, 480, 270);
  observations.eraLandmarkRegression = {
    eras: eraLandmarkStates,
    differences: eraLandmarkDifferences,
    contactSheet: "era-landmark-contact-sheet.png",
  };
  checks.push("all five era landmarks render as distinct non-blank scenes");

  const eraSetPieceCards = [];
  const eraSetPieceStates = [];
  const closeUpUiStyle = await desktop.addStyleTag({
    content: ".hud, .desktop-help, .touch-controls { visibility: hidden !important; }",
  });
  for (let eraIndex = 0; eraIndex < eraGeometry.length; eraIndex += 1) {
    const geometry = eraGeometry[eraIndex];
    const half = geometry.baseRadius * geometry.arenaUnits;
    const setPieceX = half * 0.31;
    const setPieceZ = -half * 0.42;
    const closeRadiusRatio = 0.3;
    const playerX = setPieceX;
    const playerZ = setPieceZ + geometry.baseRadius * 2.8;
    const setPieceTop = geometry.baseRadius * geometry.setPieceTopRatio;
    const framingTop = setPieceTop * (eraIndex === 2 ? 1 : 1.5);
    const cameraDistance = Math.max(geometry.baseRadius * 9.4, framingTop * 2.55);
    const cameraEye = [
      setPieceX,
      framingTop * 0.56 + geometry.baseRadius * 1.15,
      setPieceZ + cameraDistance,
    ];
    const cameraTarget = [setPieceX, framingTop * 0.52, setPieceZ];

    await callTestHook(desktop, "startEra", eraIndex);
    await callTestHook(desktop, "setRadiusRatio", closeRadiusRatio);
    await callTestHook(desktop, "setPlayerPosition", playerX, playerZ);
    await callTestHook(desktop, "setCameraPose", cameraEye, cameraTarget, 54);
    state = await readState(desktop);
    assert.equal(state.era.index, eraIndex + 1);
    assert.ok(angleDistance(state.camera.heading, 0) <= 0.006);
    assert.ok(Math.abs(state.player.x - playerX) <= 0.02);
    assert.ok(Math.abs(state.player.z - playerZ) <= 0.02);

    const screenshot = `era-setpiece-close-${String(eraIndex + 1).padStart(2, "0")}.png`;
    const path = await captureCanvas(desktop, screenshot);
    const projectedSpan = projectSetPieceVerticalSpan(
      state.camera,
      setPieceZ,
      geometry.baseRadius * geometry.setPieceTopRatio,
      720,
    );
    assert.ok(
      projectedSpan.visibleHeightPx >= 180,
      `${eraLandmarkLabels[eraIndex]} close set-piece should occupy at least 180px; actual=${projectedSpan.visibleHeightPx}`,
    );
    const vividMagentaPixels = await countVividMagentaPixels(path);
    assert.equal(
      vividMagentaPixels,
      0,
      `${eraLandmarkLabels[eraIndex]} close set-piece should not expose chroma-key magenta`,
    );
    eraSetPieceCards.push({ label: `${eraLandmarkLabels[eraIndex]} close`, path });
    eraSetPieceStates.push({
      label: eraLandmarkLabels[eraIndex],
      era: state.era,
      setPiece: {
        x: Number(setPieceX.toFixed(2)),
        z: Number(setPieceZ.toFixed(2)),
      },
      player: {
        x: state.player.x,
        z: state.player.z,
      },
      camera: state.camera,
      projectedSpan,
      vividMagentaPixels,
      screenshot,
    });
  }
  await closeUpUiStyle.evaluate((style) => style.remove());
  await buildContactSheet(
    eraSetPieceCards,
    "era-setpiece-close-contact-sheet.png",
    3,
    480,
    270,
  );
  observations.eraSetPieceCloseRegression = {
    eras: eraSetPieceStates,
    contactSheet: "era-setpiece-close-contact-sheet.png",
  };
  checks.push("all five era set-pieces render from deterministic front close-up positions");

  for (let eraIndex = 1; eraIndex < 5; eraIndex += 1) {
    await callTestHook(desktop, "startEra", eraIndex);
    state = await readState(desktop);
    assert.equal(state.era.index, eraIndex + 1);
    await callTestHook(desktop, "completeEra");
    state = await readState(desktop);
    assert.ok(state.goal.collected >= state.goal.required);
    assert.equal(state.goal.bossTarget.collected, true);
    if (eraIndex < 4) {
      assert.equal(state.mode, "eraClear");
    }
  }
  state = await readState(desktop);
  assert.equal(state.era.index, 5);
  assert.equal(state.mode, "victory");
  assertEndCondition(state, ["finalVictory"], "desktop final victory HUD");
  await assertOverlayMessaging(desktop, "victory", [/시간 구슬/, /거대 목표/, /다시 시간여행/], "desktop");
  await desktop.screenshot({ path: new URL("desktop-victory.png", outputDir).pathname, fullPage: true });
  checks.push("all five eras and final future biodome victory");

  const terminalTimeoutRegression = [];
  for (const terminalCase of [
    { eraIndex: 0, expectedMode: "eraClear" },
    { eraIndex: 4, expectedMode: "victory" },
  ]) {
    await callTestHook(desktop, "startEra", terminalCase.eraIndex);
    await callTestHook(desktop, "unlockBoss");
    state = await readState(desktop);
    const target = state.goal.bossTarget;
    await callTestHook(desktop, "setRadiusRatio", (target.requiredRadius * 1.04) / (state.player.radius / state.player.growthRatio));
    await callTestHook(desktop, "warpToItem", target.id);
    await callTestHook(desktop, "setTimer", 0.001);
    await desktop.evaluate(() => window.advanceTime?.(1000 / 60));
    state = await readState(desktop);
    assert.equal(
      state.mode,
      terminalCase.expectedMode,
      `near-zero timer boss pickup should preserve ${terminalCase.expectedMode}`,
    );
    assert.equal(state.goal.bossTarget.collected, true);
    terminalTimeoutRegression.push({
      era: terminalCase.eraIndex + 1,
      mode: state.mode,
      timerSeconds: state.timer,
      bossCollected: state.goal.bossTarget.collected,
    });
  }
  observations.terminalTimeoutRegression = terminalTimeoutRegression;
  await desktop.close();

  const mobileAudioViewports = [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
  ];
  observations.mobileAudioHudLayout = [];
  for (const viewport of mobileAudioViewports) {
    const label = `mobile audio HUD ${viewport.width}x${viewport.height}`;
    const audioLayout = await browser.newPage({
      viewport,
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    trackErrors(audioLayout, label);
    await prepareStorage(audioLayout, null);
    await audioLayout.goto(url, { waitUntil: "domcontentloaded" });
    await audioLayout.waitForSelector("#start-btn");
    await audioLayout.click("#start-btn");
    await waitForVisualAssets(audioLayout);
    await callTestHook(audioLayout, "startEra", 0);
    await callTestHook(audioLayout, "setRadiusRatio", 0.35);
    await assertMobileAudioHudLayout(audioLayout, viewport, `${label} before pickup`);
    await audioLayout.screenshot({
      path: new URL(`mobile-audio-hud-pre-pickup-${viewport.width}x${viewport.height}.png`, outputDir).pathname,
      fullPage: true,
    });
    state = await readState(audioLayout);
    const layoutPickup = state.nearby.find((entry) => entry.collectible && !entry.special);
    assert.ok(layoutPickup, `${label} needs a deterministic pickup to show game-message`);
    await callTestHook(audioLayout, "warpToItem", layoutPickup.id);
    assert.equal(await callTestHook(audioLayout, "collectItem", layoutPickup.id), true);
    await audioLayout.evaluate(() => window.advanceTime?.(1000 / 60));
    await assertMobilePickupHidesAudioHud(audioLayout, viewport, `${label} pickup`);
    await audioLayout.screenshot({
      path: new URL(`mobile-audio-hud-pickup-${viewport.width}x${viewport.height}.png`, outputDir).pathname,
      fullPage: true,
    });
    observations.mobileAudioHudLayout.push({
      viewport,
      prePickupScreenshot: `mobile-audio-hud-pre-pickup-${viewport.width}x${viewport.height}.png`,
      pickupScreenshot: `mobile-audio-hud-pickup-${viewport.width}x${viewport.height}.png`,
    });
    await audioLayout.close();
  }
  checks.push("mobile audio controls show Korean on/off state before pickup, avoid top-HUD overlap, and hide during pickup callout at 320, 360, and 390 widths");

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  trackErrors(mobile, "mobile");
  await mobile.goto(url, { waitUntil: "domcontentloaded" });
  await mobile.waitForSelector("#start-btn");
  await mobile.screenshot({ path: new URL("mobile-intro.png", outputDir).pathname, fullPage: true });
  const layout = await mobile.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    startVisible: !!document.querySelector("#start-btn")?.getBoundingClientRect().height,
    touchDisplay: getComputedStyle(document.querySelector(".touch-controls")).display,
  }));
  assert.ok(layout.documentWidth <= layout.viewport + 1);
  assert.equal(layout.startVisible, true);
  assert.notEqual(layout.touchDisplay, "none");

  await mobile.click("#start-btn");
  await waitForVisualAssets(mobile);
  const beforeJoystick = await readState(mobile);
  const mobileOpeningMarkers = assertMarkerTelemetry(beforeJoystick, "mobile opening");
  assert.equal(mobileOpeningMarkers.maxTargets, 1);
  await mobile.screenshot({ path: new URL("mobile-playing.png", outputDir).pathname, fullPage: true });
  observations.mobileRenderStats = {
    initial: beforeJoystick.renderStats,
  };
  assertMobileRenderBudget(beforeJoystick.renderStats, "initial mobile play");
  checks.push(`mobile p95 telemetry captured under noisy SwiftShader only: ${beforeJoystick.renderStats.frameMsP95}ms`);
  const joystick = mobile.locator(".joystick");
  const box = await joystick.boundingBox();
  assert.ok(box, "mobile joystick should have a bounding box");
  await mobile.mouse.move(box.x + box.width / 2, box.y + 8);
  await mobile.mouse.down();
  await mobile.evaluate(() => window.advanceTime?.(1800));
  await mobile.mouse.up();
  state = await readState(mobile);
  const moved = Math.hypot(state.player.x - beforeJoystick.player.x, state.player.z - beforeJoystick.player.z);
  assert.ok(moved > 0.1, `joystick should move player; moved=${moved}`);
  assertRollingCue(state, { active: true, reason: "moving" }, "mobile joystick movement");
  assertMarkerTelemetry(state, "mobile movement");
  observations.mobileRenderStats.moving = state.renderStats;
  assertMobileRenderBudget(state.renderStats, "mobile joystick movement");
  await mobile.screenshot({ path: new URL("mobile-moving.png", outputDir).pathname, fullPage: true });
  checks.push("mobile fit and pointer joystick movement");

  await callTestHook(mobile, "startEra", 0);
  await callTestHook(mobile, "setRadiusRatio", 0.35);
  state = await readState(mobile);
  const mobilePickup = state.nearby.find((entry) => entry.collectible && !entry.special);
  assert.ok(mobilePickup, "mobile pickup FX needs a deterministic collectible");
  await callTestHook(mobile, "warpToItem", mobilePickup.id);
  assert.equal(await callTestHook(mobile, "collectItem", mobilePickup.id), true);
  await mobile.evaluate(() => window.advanceTime?.(1000 / 60));
  state = await readState(mobile);
  const mobileSuccessFeedback = requireTelemetryObject(state, "feedback");
  assert.equal(feedbackIndicatesSuccess(mobileSuccessFeedback), true, `mobile pickup should expose success feedback; feedback=${JSON.stringify(mobileSuccessFeedback)}`);
  assert.equal(feedbackHasParticles(mobileSuccessFeedback), true, `mobile pickup should expose pickup particles; feedback=${JSON.stringify(mobileSuccessFeedback)}`);
  assertMarkerTelemetry(state, "mobile pickup success");
  observations.mobileRenderStats.pickupSuccess = state.renderStats;
  assertMobileRenderBudget(state.renderStats, "mobile pickup success FX");
  assert.match(await mobile.locator("body").innerText(), /수집 성공!/, "mobile should show a visible pickup success callout");
  await mobile.screenshot({ path: new URL("mobile-pickup-success.png", outputDir).pathname, fullPage: true });
  await mobile.evaluate(() => window.advanceTime?.(1000));
  checks.push("mobile pickup success callout and FX are visible");

  await callTestHook(mobile, "startEra", 0);
  await mobile.evaluate(() => window.advanceTime?.(200000));
  await assertOverlayMessaging(mobile, "timeUp", [/시간 종료/, /조금만 더 굴려볼까요/, /이 시대 다시 도전/], "mobile");
  await mobile.screenshot({ path: new URL("mobile-time-up.png", outputDir).pathname, fullPage: true });
  checks.push("mobile time-up overlay preserves record and retry messaging");

  await callTestHook(mobile, "startEra", 0);
  state = await readState(mobile);
  assertEndCondition(state, ["collect"], "mobile collect HUD");
  await callTestHook(mobile, "completeEra");
  await assertOverlayMessaging(mobile, "eraClear", [/거대 코어/, /시대 점수/, /다음 시대로/], "mobile");
  await mobile.screenshot({ path: new URL("mobile-era-clear.png", outputDir).pathname, fullPage: true });
  checks.push("mobile era-clear overlay preserves boss and scoring messaging");

  await callTestHook(mobile, "startEra", 4);
  await callTestHook(mobile, "completeEra");
  state = await readState(mobile);
  assertEndCondition(state, ["finalVictory"], "mobile final victory HUD");
  await assertOverlayMessaging(mobile, "victory", [/시간 구슬/, /거대 목표/, /다시 시간여행/], "mobile");
  await mobile.screenshot({ path: new URL("mobile-victory.png", outputDir).pathname, fullPage: true });
  checks.push("mobile final victory overlay preserves explicit final messaging");
  await mobile.close();
} finally {
  await browser.close();
}

assert.deepEqual(errors, [], `browser errors found:\n${errors.join("\n")}`);
const result = {
  passed: checks.length,
  checks,
  observations,
  errors,
  completedAt: new Date().toISOString(),
};
await writeFile(new URL("result.json", outputDir), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

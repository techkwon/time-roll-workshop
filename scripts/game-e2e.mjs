import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const url = process.env.GAME_URL || "http://localhost:3000";
const outputDir = new URL("../output/e2e/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const errors = [];
const checks = [];
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader"],
});

async function readState(page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "render_game_to_text should return game state");
  return JSON.parse(raw);
}

function trackErrors(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${label} pageerror: ${String(error)}`));
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  trackErrors(desktop, "desktop");
  await desktop.goto(url, { waitUntil: "domcontentloaded" });
  await desktop.waitForSelector("#start-btn");
  await desktop.screenshot({ path: new URL("desktop-intro.png", outputDir).pathname, fullPage: true });
  assert.equal(await desktop.locator("canvas").count(), 1);
  assert.equal(await desktop.getByRole("button", { name: "시간 구슬 굴리기" }).isVisible(), true);
  checks.push("desktop intro and start control");

  await desktop.click("#start-btn");
  let state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.era.index, 1);

  await desktop.keyboard.down("ArrowUp");
  await desktop.evaluate(() => window.advanceTime?.(5200));
  await desktop.keyboard.up("ArrowUp");
  state = await readState(desktop);
  assert.equal(state.mode, "eraClear");
  assert.ok(state.goal.collected >= state.goal.required);
  await desktop.screenshot({ path: new URL("desktop-era-clear.png", outputDir).pathname, fullPage: true });
  checks.push("real keyboard roll collects 8 items and clears era 1");

  await desktop.getByRole("button", { name: "다음 시대로" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  assert.equal(state.era.index, 2);

  await desktop.getByRole("button", { name: "게임 잠시 멈추기" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "paused");
  await desktop.getByRole("button", { name: "계속 굴리기" }).click();
  state = await readState(desktop);
  assert.equal(state.mode, "playing");
  checks.push("pause and resume");

  await desktop.keyboard.down("ArrowRight");
  await desktop.evaluate(() => window.advanceTime?.(700));
  await desktop.keyboard.up("ArrowRight");
  state = await readState(desktop);
  assert.ok(state.player.x > 0.1);
  await desktop.keyboard.press("KeyR");
  state = await readState(desktop);
  assert.equal(state.era.index, 2);
  assert.equal(state.player.x, 0);
  assert.equal(state.player.z, 0);
  checks.push("movement and era retry");

  while ((await readState(desktop)).era.index < 5) {
    await desktop.keyboard.down("ArrowUp");
    await desktop.evaluate(() => window.advanceTime?.(6500));
    await desktop.keyboard.up("ArrowUp");
    state = await readState(desktop);
    assert.equal(state.mode, "eraClear");
    assert.ok(state.goal.collected >= state.goal.required);
    const nextButton = desktop.getByRole("button", { name: "다음 시대로" });
    await nextButton.waitFor({ state: "visible" });
    await nextButton.click();
  }
  state = await readState(desktop);
  assert.equal(state.era.index, 5);
  await desktop.keyboard.down("ArrowUp");
  await desktop.evaluate(() => window.advanceTime?.(9000));
  await desktop.keyboard.up("ArrowUp");
  state = await readState(desktop);
  assert.equal(state.mode, "victory");
  await desktop.screenshot({ path: new URL("desktop-victory.png", outputDir).pathname, fullPage: true });
  checks.push("all five eras and final future biodome victory");
  await desktop.close();

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
  const joystick = mobile.locator(".joystick");
  const box = await joystick.boundingBox();
  assert.ok(box, "mobile joystick should have a bounding box");
  await mobile.mouse.move(box.x + box.width / 2, box.y + 8);
  await mobile.mouse.down();
  await mobile.evaluate(() => window.advanceTime?.(1800));
  await mobile.mouse.up();
  state = await readState(mobile);
  assert.ok(state.player.z < -0.1, `joystick should move player forward; z=${state.player.z}`);
  await mobile.screenshot({ path: new URL("mobile-playing.png", outputDir).pathname, fullPage: true });
  checks.push("mobile fit and pointer joystick movement");
  await mobile.close();
} finally {
  await browser.close();
}

assert.deepEqual(errors, [], `browser errors found:\n${errors.join("\n")}`);
const result = {
  passed: checks.length,
  checks,
  errors,
  completedAt: new Date().toISOString(),
};
await writeFile(new URL("result.json", outputDir), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;
const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished Korean game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /<html[^>]*lang="ko"/i);
  assert.match(html, /<title>데굴데굴 시간공작소 \| 3D 시대 수집 게임<\/title>/i);
  assert.match(html, /데굴데굴/);
  assert.match(html, /시간공작소/);
  assert.match(html, /시간 구슬 굴리기/);
  assert.match(html, /제조/);
  assert.match(html, /건설/);
  assert.match(html, /수송/);
  assert.match(html, /통신/);
  assert.match(html, /생명/);
  assert.match(html, /<canvas/i);
  assert.doesNotMatch(html, /react-loading-skeleton|Your site is taking shape/i);
});

test("removes starter preview and exposes game testing hooks", async () => {
  const [game, css, page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/TimeRollGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(game, /window\.render_game_to_text/);
  assert.match(game, /window\.advanceTime/);
  assert.match(game, /requestFullscreen/);
  assert.match(game, /localStorage/);
  assert.match(game, /onPointerMove/);
  assert.match(game, /getContext\("webgl"/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.touch-controls/);
  assert.match(page, /<TimeRollGame \/>/);
  assert.match(layout, /lang="ko"/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|Starter Project/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/", templateRoot)));
});

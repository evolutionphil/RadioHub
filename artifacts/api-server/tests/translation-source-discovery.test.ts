import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  resolveTranslationSourceDirectory,
  TranslationSyncService,
} from "../src/services/translation-sync";

describe("Translation source discovery without a database", () => {
  let directory = "";
  const originalSource = process.env.TRANSLATION_SOURCE_DIR;
  before(async () => {
    directory = await mkdtemp(
      path.join(os.tmpdir(), "radiohub-translation-source-"),
    );
  });
  beforeEach(() => {
    delete process.env.TRANSLATION_SOURCE_DIR;
  });
  after(async () => {
    if (originalSource === undefined) delete process.env.TRANSLATION_SOURCE_DIR;
    else process.env.TRANSLATION_SOURCE_DIR = originalSource;
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.match(path.basename(directory), /^radiohub-translation-source-/);
    await rm(directory, { recursive: true, force: true });
  });
  it("resolves frontend source from the pnpm API package working directory", () => {
    const api = path.resolve(import.meta.dirname, "..");
    assert.equal(
      resolveTranslationSourceDirectory(api),
      path.resolve(api, "../megaradio/src"),
    );
  });
  it("resolves the source packaged below the deployed API root", async () => {
    const source = path.join(directory, "artifacts", "megaradio", "src");
    await mkdir(source, { recursive: true });
    assert.equal(resolveTranslationSourceDirectory(directory), source);
  });
  it("respects an explicit relative source directory", async () => {
    await mkdir(path.join(directory, "custom"), { recursive: true });
    process.env.TRANSLATION_SOURCE_DIR = "custom";
    assert.equal(
      resolveTranslationSourceDirectory(directory),
      path.join(directory, "custom"),
    );
  });
  it("rejects an unavailable configured source instead of returning an empty successful scan", async () => {
    process.env.TRANSLATION_SOURCE_DIR = path.join(directory, "does-not-exist");
    await assert.rejects(
      TranslationSyncService.scanFrontendForKeys(),
      /not an existing directory/,
    );
  });
  it("finds keys deterministically across nested TS/TSX files and excludes interpolated/duplicate keys", async () => {
    const source = path.join(directory, "scan");
    await mkdir(path.join(source, "nested"), { recursive: true });
    await writeFile(
      path.join(source, "a.tsx"),
      't("first_key", "First");\nt("duplicate_key", "Original");\nt(`dynamic_${id}`);',
    );
    await writeFile(
      path.join(source, "nested", "b.ts"),
      't("second_key");\nt("duplicate_key", "Later");',
    );
    await writeFile(
      path.join(source, "ignored.js"),
      't("ignored_key", "Ignored");',
    );
    process.env.TRANSLATION_SOURCE_DIR = source;
    const keys = await TranslationSyncService.scanFrontendForKeys();
    assert.deepEqual(
      keys.map((key) => [key.key, key.defaultValue]),
      [
        ["first_key", "First"],
        ["duplicate_key", "Original"],
        ["second_key", "second_key"],
      ],
    );
    assert.equal(keys[1].lineNumber, 2);
    assert.equal(keys[2].filePath, path.join("nested", "b.ts"));
  });

  it("discovers multiline calls and defaults while preserving each call's starting line", async () => {
    const source = path.join(directory, "multiline");
    await mkdir(source);
    await writeFile(
      path.join(source, "search.tsx"),
      [
        "// Fixture uses the same wrapped call shape as the search page.",
        "const intro = t(",
        '  "search_page_intro",',
        '  "Search Mega Radio\'s catalogue."',
        ");",
        "const hint = t(",
        '  "search_min_chars_hint",',
        '  "Type at least 2 characters."',
        ");",
        't("same_line_key"); t(',
        '  "search_esc_clear_hint_suffix",',
        '  "to clear the highlighted result."',
        ");",
      ].join("\r\n"),
    );
    process.env.TRANSLATION_SOURCE_DIR = source;
    const keys = await TranslationSyncService.scanFrontendForKeys();
    assert.deepEqual(
      keys.map(({ key, defaultValue, lineNumber }) => ({
        key,
        defaultValue,
        lineNumber,
      })),
      [
        {
          key: "search_page_intro",
          defaultValue: "Search Mega Radio's catalogue.",
          lineNumber: 2,
        },
        {
          key: "search_min_chars_hint",
          defaultValue: "Type at least 2 characters.",
          lineNumber: 6,
        },
        { key: "same_line_key", defaultValue: "same_line_key", lineNumber: 10 },
        {
          key: "search_esc_clear_hint_suffix",
          defaultValue: "to clear the highlighted result.",
          lineNumber: 10,
        },
      ],
    );
  });
});

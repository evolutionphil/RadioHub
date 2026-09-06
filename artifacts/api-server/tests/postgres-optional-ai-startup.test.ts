import { after, mock, test } from "node:test";
import assert from "node:assert/strict";

let constructions = 0,
  requests = 0;
const previousKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
mock.module("openai", {
  defaultExport: class {
    constructor() {
      constructions++;
    }
    chat = {
      completions: {
        create: async () => {
          requests++;
          return {
            choices: [
              {
                message: {
                  content:
                    "A station description with verified local context and a varied programme of music and spoken content. ".repeat(
                      4,
                    ) +
                    "===A distinctive station with a varied local schedule and music programming for listeners.",
                },
              },
            ],
          };
        },
      },
    };
  },
});
const ai = await import("../src/services/ai-station-description");
after(() => {
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
  mock.restoreAll();
});

test("optional AI import and language helpers never require credentials or construct a client", () => {
  assert.equal(constructions, 0);
  assert.equal(requests, 0);
  assert.equal(
    ai.detectStationLanguage({
      _id: "test",
      name: "Fixture",
      countryCode: "DE",
    }),
    "de",
  );
});
test("actual missing-key generation fails explicitly without fabricated content or network", async () => {
  const result = await ai.generateStationDescription(
    { _id: "test", name: "Fixture" },
    "en",
  );
  assert.equal(result.success, false);
  assert.match(result.error || "", /OPENAI_API_KEY is not configured/);
  assert.equal(result.fullDescription, undefined);
  assert.equal(constructions, 0);
  assert.equal(requests, 0);
  await assert.rejects(
    ai.translateDescription("full", "meta", "en", ["de"], "Fixture"),
    /OPENAI_API_KEY is not configured/,
  );
  assert.equal(
    (await ai.translateDescription("full", "meta", "en", ["en"], "Fixture"))
      .size,
    0,
  );
});
test("a configured invocation constructs one client lazily and reuses it", async () => {
  process.env.OPENAI_API_KEY = "unit-test-key-no-external-requests";
  assert.equal(
    (
      await ai.generateStationDescription(
        { _id: "test", name: "Fixture" },
        "en",
      )
    ).success,
    true,
  );
  assert.equal(
    (
      await ai.generateStationDescription(
        { _id: "test", name: "Fixture" },
        "en",
      )
    ).success,
    true,
  );
  assert.equal(constructions, 1);
  assert.equal(requests, 2);
});

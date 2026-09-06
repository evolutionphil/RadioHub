import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { logger } from "../utils/logger";
import { pgLocalization } from "../data/postgres-localization-store";
import {
  pgTranslationSync,
  type GeneratedTranslation,
  type TranslationSyncWriter,
} from "../data/postgres-translation-sync-store";

interface ExtractedKey {
  key: string;
  defaultValue: string;
  filePath: string;
  lineNumber: number;
}

/** Supports repo-root, pnpm package cwd, and the packaged Docker frontend source. */
export function resolveTranslationSourceDirectory(cwd = process.cwd()): string {
  const configured = process.env.TRANSLATION_SOURCE_DIR;
  if (configured) {
    const resolved = path.resolve(cwd, configured);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw Object.assign(
        new Error(
          "TRANSLATION_SOURCE_DIR is not an existing directory: " + resolved,
        ),
        { code: "ENOENT" },
      );
    }
    return resolved;
  }
  const candidates = new Set<string>();
  for (const start of [cwd, path.dirname(fileURLToPath(import.meta.url))]) {
    let current = path.resolve(start);
    for (;;) {
      candidates.add(path.join(current, "artifacts", "megaradio", "src"));
      candidates.add(path.join(current, "client", "src"));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  const found = [...candidates].find(
    (candidate) =>
      fs.existsSync(candidate) && fs.statSync(candidate).isDirectory(),
  );
  if (!found)
    throw Object.assign(
      new Error(
        "Frontend translation source is unavailable; package artifacts/megaradio/src or configure TRANSLATION_SOURCE_DIR",
      ),
      { code: "ENOENT" },
    );
  return found;
}

export class TranslationSyncService {
  private static isRunning = false;
  private static lastSyncTime: Date | null = null;

  private static async withLeader<T>(
    operation: (writer: TranslationSyncWriter) => Promise<T>,
  ): Promise<T> {
    if (this.isRunning)
      throw Object.assign(new Error("Translation sync is already running"), {
        status: 409,
      });
    this.isRunning = true;
    try {
      return await pgTranslationSync().withLeader(operation);
    } finally {
      this.isRunning = false;
    }
  }

  static async scanFrontendForKeys(): Promise<ExtractedKey[]> {
    const clientDir = resolveTranslationSourceDirectory();
    const uniqueKeys = new Map<string, ExtractedKey>();
    const scanDirectory = async (dir: string): Promise<void> => {
      // Failure is not an empty/partial successful scan. Do not follow symlinks outside the source tree.
      const entries = (await fsp.readdir(dir, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      );
      for (const entry of entries) {
        const filePath = path.join(dir, entry.name);
        if (entry.isDirectory()) await scanDirectory(filePath);
        else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
          const content = await fsp.readFile(filePath, "utf8");
          let lineNumber = 1;
          let countedThrough = 0;
          // Scan whole calls, including arguments wrapped onto later lines.
          // Match each literal's own quote so apostrophes inside double quotes remain intact.
          for (const match of content.matchAll(
            /\bt\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1(?:\s*,\s*(["'`])((?:\\.|(?!\3)[^\\])*)\3)?/g,
          )) {
            while (countedThrough < match.index) {
              if (content.charCodeAt(countedThrough++) === 10) lineNumber++;
            }
            const key = match[2];
            if (key.length > 2 && !key.includes("${") && !uniqueKeys.has(key)) {
              uniqueKeys.set(key, {
                key,
                defaultValue: match[4] || key,
                filePath: path.relative(clientDir, filePath),
                lineNumber,
              });
            }
          }
        }
      }
    };
    await scanDirectory(clientDir);
    return [...uniqueKeys.values()];
  }

  private static async syncKeys(
    writer: TranslationSyncWriter,
  ): Promise<{ added: number; existing: number }> {
    const extracted = await this.scanFrontendForKeys();
    writer.assertOwned();
    return writer.syncKeys(
      extracted.map((key) => ({
        key: key.key,
        defaultValue: key.defaultValue,
        description:
          "Auto-discovered from " + key.filePath + ":" + key.lineNumber,
        category: this.categorizeKey(key.key),
        isPlural: false,
      })),
    );
  }

  static async syncNewKeys(): Promise<{ added: number; existing: number }> {
    return this.withLeader((writer) => this.syncKeys(writer));
  }

  private static categorizeKey(key: string): string {
    if (key.startsWith("nav_")) return "navigation";
    if (key.startsWith("button_")) return "buttons";
    if (key.startsWith("station_")) return "station";
    if (key.startsWith("error_")) return "errors";
    if (key.startsWith("general_")) return "general";
    if (key.startsWith("footer_")) return "footer";
    if (key.startsWith("faq_")) return "faq";
    if (key.startsWith("seo_")) return "seo";
    return "general";
  }

  private static async translateLanguage(
    writer: TranslationSyncWriter,
    langCode: string,
  ): Promise<{ translated: number; failed: number }> {
    writer.assertOwned();
    if (langCode === "en") return { translated: 0, failed: 0 };
    const store = pgLocalization();
    const language = await store.findTranslationLanguage(langCode);
    if (!language || !language.isEnabled) return { translated: 0, failed: 0 };
    const allKeys = await store.getKeys();
    const existing = new Map(
      (await store.listTranslations(langCode)).map((row) => [
        String(row.keyId),
        row,
      ]),
    );
    const missingKeys = allKeys.filter((key) => {
      const row = existing.get(String(key._id));
      return !row || !row.isCompleted || !row.value.trim();
    });
    if (!missingKeys.length) return { translated: 0, failed: 0 };
    if (!process.env.OPENAI_API_KEY)
      throw new Error(
        "OPENAI_API_KEY is required to generate missing translations",
      );
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let translated = 0;
    let failed = 0;
    const languageMapping: Record<string, string> = {
      af: "Afrikaans",
      am: "Amharic",
      ar: "Arabic",
      az: "Azerbaijani",
      bg: "Bulgarian",
      bn: "Bengali",
      bs: "Bosnian",
      cs: "Czech",
      da: "Danish",
      de: "German",
      el: "Greek",
      es: "Spanish",
      et: "Estonian",
      fa: "Persian",
      fi: "Finnish",
      fr: "French",
      gu: "Gujarati",
      he: "Hebrew",
      hi: "Hindi",
      hr: "Croatian",
      hu: "Hungarian",
      hy: "Armenian",
      id: "Indonesian",
      it: "Italian",
      ja: "Japanese",
      kn: "Kannada",
      ko: "Korean",
      lt: "Lithuanian",
      lv: "Latvian",
      ml: "Malayalam",
      mr: "Marathi",
      ms: "Malay",
      nl: "Dutch",
      no: "Norwegian",
      pa: "Punjabi",
      pl: "Polish",
      pt: "Portuguese",
      ro: "Romanian",
      ru: "Russian",
      sk: "Slovak",
      sl: "Slovenian",
      so: "Somali",
      sq: "Albanian",
      sr: "Serbian",
      sv: "Swedish",
      sw: "Swahili",
      ta: "Tamil",
      te: "Telugu",
      th: "Thai",
      tl: "Tagalog",
      tr: "Turkish",
      uk: "Ukrainian",
      ur: "Urdu",
      vi: "Vietnamese",
      zh: "Chinese",
      zu: "Zulu",
      ba: "Bosnian",
    };
    const targetLanguage = languageMapping[langCode] || language.name;
    for (let offset = 0; offset < missingKeys.length; offset += 10) {
      writer.assertOwned();
      const batch = missingKeys.slice(offset, offset + 10);
      let values: Record<string, unknown>;
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a professional translator. Translate UI strings from English to " +
                targetLanguage +
                ". Keep Mega Radio unchanged. Preserve all placeholders such as {COUNTRY}, {STATION_NAME}, {count} exactly. Use concise natural UI wording. Return only a JSON object with the input keys.",
            },
            {
              role: "user",
              content: JSON.stringify(
                batch.map((key) => ({
                  key: key.key,
                  english: key.defaultValue,
                })),
              ),
            },
          ],
          temperature: 0.3,
          response_format: { type: "json_object" },
        });
        writer.assertOwned();
        const content = response.choices[0]?.message?.content;
        if (!content?.trim())
          throw new Error("Translation provider returned an empty response");
        values = JSON.parse(content);
        if (!values || typeof values !== "object" || Array.isArray(values))
          throw new Error(
            "Translation provider returned a non-object response",
          );
      } catch (error) {
        // Provider errors are retryable per-key failures; losing ownership is fatal.
        writer.assertOwned();
        logger.log("Translation batch failed for " + langCode + ":", error);
        failed += batch.length;
        continue;
      }
      const inputs: GeneratedTranslation[] = [];
      for (const key of batch) {
        const value = Object.hasOwn(values, key.key)
          ? values[key.key]
          : undefined;
        const placeholders = (text: string) =>
          (text.match(/\{[^{}]+\}/g) || []).sort();
        if (
          typeof value !== "string" ||
          !value.trim() ||
          JSON.stringify(placeholders(value)) !==
            JSON.stringify(placeholders(key.defaultValue))
        ) {
          failed++;
          continue;
        }
        inputs.push({
          keyId: String(key._id),
          defaultValue: key.defaultValue,
          language: langCode,
          value,
          observed: existing.get(String(key._id)),
        });
      }
      writer.assertOwned();
      // Database failures propagate; the batch and metadata version commit together.
      if (inputs.length) translated += await writer.saveGenerated(inputs);
    }
    return { translated, failed };
  }

  static async translateMissingForLanguage(
    langCode: string,
  ): Promise<{ translated: number; failed: number }> {
    return this.withLeader((writer) =>
      this.translateLanguage(writer, langCode),
    );
  }

  private static async translateLanguages(
    writer: TranslationSyncWriter,
  ): Promise<{
    totalTranslated: number;
    totalFailed: number;
    languages: number;
  }> {
    const languages = (
      await pgLocalization().getTranslationLanguages(true)
    ).filter((language) => language.code !== "en");
    let totalTranslated = 0;
    let totalFailed = 0;
    for (const language of languages) {
      const result = await this.translateLanguage(writer, language.code);
      totalTranslated += result.translated;
      totalFailed += result.failed;
    }
    return { totalTranslated, totalFailed, languages: languages.length };
  }

  static async translateAllMissing(): Promise<{
    totalTranslated: number;
    totalFailed: number;
    languages: number;
  }> {
    return this.withLeader((writer) => this.translateLanguages(writer));
  }

  static async runFullSync(): Promise<{
    keysAdded: number;
    keysExisting: number;
    translated: number;
    failed: number;
    languages: number;
  }> {
    return this.withLeader(async (writer) => {
      const { added: keysAdded, existing: keysExisting } =
        await this.syncKeys(writer);
      // Retry prior failures and incomplete rows even when the source contains no new keys.
      const {
        totalTranslated: translated,
        totalFailed: failed,
        languages,
      } = await this.translateLanguages(writer);
      writer.assertOwned();
      this.lastSyncTime = new Date();
      return { keysAdded, keysExisting, translated, failed, languages };
    });
  }

  static getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }
  static isCurrentlyRunning(): boolean {
    return this.isRunning;
  }

  static async scanForNewKeys(): Promise<{
    keysAdded: number;
    keysExisting: number;
  }> {
    return this.withLeader(async (writer) => {
      const { added: keysAdded, existing: keysExisting } =
        await this.syncKeys(writer);
      writer.assertOwned();
      this.lastSyncTime = new Date();
      return { keysAdded, keysExisting };
    });
  }
}

export async function runTranslationSync() {
  return TranslationSyncService.runFullSync();
}
export async function scanAndAddNewKeys() {
  return TranslationSyncService.scanForNewKeys();
}

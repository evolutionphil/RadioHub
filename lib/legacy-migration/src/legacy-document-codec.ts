import crypto from "node:crypto";
import { BSON } from "mongodb";

// Offline fidelity tests share this exact driver codec without depending on
// MongoDB packages from the production API workspace (including dev deps).
export { BSON };

export function jsonSafe(document: Record<string, any>): Record<string, any> {
  return JSON.parse(JSON.stringify(document, function (key, value) {
    // Long has no numeric JSON representation. With promoteValues:false it
    // otherwise becomes {high,low,unsigned}, breaking IDs and numeric fields.
    // Decimal text also avoids silent IEEE-754 rounding above 2^53.
    const original = this[key];
    return original?._bsontype === "Long" ? original.toString() : value;
  }));
}

export function bsonSafe(document: Record<string, any>): Record<string, any> {
  return BSON.EJSON.serialize(document, { relaxed: false });
}

// JSONB changes object key order. Hash the same canonical tree before insertion
// and after reading it back, including nested objects but retaining array order.
export function checksum(payload: unknown): string {
  const canonical = (value: any): any => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}

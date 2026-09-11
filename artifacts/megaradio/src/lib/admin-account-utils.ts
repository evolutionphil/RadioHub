export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Admin reports use UTC consistently, including every millisecond of the last day. */
export function adminDateRange(from: string, to: string, required = false) {
  const valid = (!required || (!!from && !!to)) && (!from || isCalendarDate(from)) &&
    (!to || isCalendarDate(to)) && (!from || !to || from <= to);
  return { valid, from: valid && from ? `${from}T00:00:00.000Z` : "", to: valid && to ? `${to}T23:59:59.999Z` : "" };
}

export function formatAdminMoney(amount: number | undefined | null, currency: string | undefined | null): string {
  if (typeof amount !== "number" || !Number.isFinite(amount) || !currency) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100); }
  catch { return "—"; }
}

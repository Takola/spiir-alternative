import { describe, expect, it } from "vitest";

import {
    formatCurrency,
    formatDateTime,
    formatDkk,
    formatIsoDate,
    formatMobileIsoDate,
    formatMonthLabel,
    formatOneDecimal,
    formatPostingAmount,
    formatSignedPostingAmount,
    formatWholeDkk,
    formatWholeNumber,
} from "./formatting";

describe("Danish number formatting", () => {
    it("formats whole numbers, posting amounts and signed credits", () => {
        expect(formatWholeNumber(1234.4)).toBe("1.234");
        expect(formatWholeNumber(null)).toBe("");
        expect(formatPostingAmount(-1234.5)).toBe("-1.234,50");
        expect(formatSignedPostingAmount(1234.5)).toBe("+1.234,50");
        expect(formatSignedPostingAmount(-1234.5)).toBe("-1.234,50");
    });

    it("formats currency and percentages consistently", () => {
        expect(formatWholeDkk(1234.5)).toBe("1.235 kr");
        expect(formatDkk(1234.5)).toContain("1.234,50");
        expect(formatCurrency(1234.5, "EUR")).toContain("1.235");
        expect(formatOneDecimal(12.34)).toBe("12,3");
    });
});

describe("Danish date formatting", () => {
    it("formats ISO dates and retains invalid values", () => {
        expect(formatIsoDate("2026-08-13")).toBe("13-08-2026");
        expect(formatIsoDate("2026-08-13", "/")).toBe("13/08/2026");
        expect(formatIsoDate("not-a-date")).toBe("date-a-not");
        expect(formatIsoDate("not-a-complete-date")).toBe("complete-a-not");
        expect(formatDateTime(null)).toBe("-");
        expect(formatDateTime("not-a-date")).toBe("not-a-date");
    });

    it("formats mobile and month labels", () => {
        expect(formatMobileIsoDate("2026-08-13")).toContain("2026");
        expect(formatMonthLabel("2026-08")).toContain("2026");
        expect(formatMonthLabel("invalid")).toBe("invalid");
    });
});

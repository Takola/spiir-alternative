const LOCALE = "da-DK";

const wholeNumberFormatter = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});

const postingAmountFormatter = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const oneDecimalFormatter = new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: 1,
});

export function formatWholeNumber(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "";
    }
    return wholeNumberFormatter.format(value);
}

export function formatPostingAmount(value: number): string {
    return postingAmountFormatter.format(value);
}

export function formatSignedPostingAmount(value: number): string {
    const formatted = formatPostingAmount(value);
    return value > 0 ? `+${formatted}` : formatted;
}

export function formatWholeDkk(value: number): string {
    return `${formatWholeNumber(value)} kr`;
}

export function formatDkk(value: number, fractionDigits = 2): string {
    return new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency: "DKK",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(value);
}

export function formatCurrency(value: number, currency: string, fractionDigits = 0): string {
    return new Intl.NumberFormat(LOCALE, {
        style: "currency",
        currency,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(value);
}

export function formatOneDecimal(value: number): string {
    return oneDecimalFormatter.format(value);
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) {
        return "-";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat(LOCALE, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(parsed);
}

export function formatIsoDate(value: string, separator = "-"): string {
    if (!value) {
        return "-";
    }
    const [year, month, day] = value.split("-");
    if (!year || !month || !day) {
        return value;
    }
    return [day, month, year].join(separator);
}

export function formatMobileIsoDate(value: string): string {
    if (!value) {
        return "-";
    }
    const [year, month, day] = value.split("-");
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (!year || !month || !day || Number.isNaN(parsed.getTime())) {
        return formatIsoDate(value);
    }
    return new Intl.DateTimeFormat(LOCALE, {
        day: "numeric",
        month: "short",
        year: "numeric",
    }).format(parsed).replace(/\.$/, "");
}

export function formatMonthLabel(value: string, short = false): string {
    const [year, month] = value.split("-");
    const parsed = new Date(Number(year), Number(month) - 1, 1);
    if (!year || !month || Number.isNaN(parsed.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat(LOCALE, short
        ? { month: "short" }
        : { month: "long", year: "numeric" }
    ).format(parsed).replace(/\.$/, "");
}

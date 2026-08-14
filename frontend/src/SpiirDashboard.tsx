import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Plot from "react-plotly.js";

import {
    getCachedSpiirData,
    getSpiirOverview,
    getSpiirStatus,
    getSpiirTransactions,
    rebuildSpiirFromLocal,
    scheduleSpiirRebuildFromLocal
} from "./api";
import { formatOneDecimal, formatWholeDkk, formatWholeNumber } from "./formatting";
import LedgerDashboard, { type LedgerDrilldownFilter } from "./LedgerDashboard";
import SpiirSunburstModal, { expenseMainColorFromHue, expenseSubColorFromHue, incomePartColorFromHue, type SunburstMode, type SunburstState } from "./SpiirSunburstModal";
import type {
    LedgerCategoryOption,
    SpiirOverviewResponse,
    SpiirOverviewRow,
    SpiirStatusResponse,
    SpiirTransaction
} from "./types";

type SpiirTab = "business" | "monthly" | "yearly";
type PeriodKind = "month" | "year";
type ChartLevel = "top" | "main" | "sub";

type ChartOptions = {
    show: boolean;
    cumulative: boolean;
    stacked: boolean;
    bars: boolean;
    level: ChartLevel;
};

type LedgerDrilldownModalState = LedgerDrilldownFilter | null;

type ChartSeries = {
    key: string;
    label: string;
    kind: "income" | "income_part" | "diff" | "expense" | "expense_total";
    y: number[];
    main: string;
    incomeHue?: number;
    expenseHue?: number;
};

const EXPENSE_MAIN_HUES = [190, 205, 220, 235, 250, 265, 280, 295, 310, 325, 340];
const INCOME_PART_HUES = [108, 118, 128, 138, 148, 158, 168];
const MONTH_WINDOW_OPTIONS = [
    { value: "3", label: "3 mdr" },
    { value: "6", label: "6 mdr" },
    { value: "12", label: "12 mdr" },
    { value: "24", label: "24 mdr" },
    { value: "all", label: "Alle" }
];
const YEAR_WINDOW_OPTIONS = [
    { value: "3", label: "3 år" },
    { value: "5", label: "5 år" },
    { value: "10", label: "10 år" },
    { value: "all", label: "Alle" }
];

function readStoredString(key: string, fallback: string): string {
    try {
        return window.localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function readStoredBool(key: string, fallback: boolean): boolean {
    return readStoredString(key, fallback ? "1" : "0") === "1";
}

function storeString(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // ignore storage failures
    }
}

function storeBool(key: string, value: boolean): void {
    storeString(key, value ? "1" : "0");
}

function formatNumber(value: number | null | undefined): string {
    return formatWholeNumber(value);
}

function hasChildren(rows: SpiirOverviewRow[], key: string): boolean {
    return rows.some((row) => row.parent === key);
}

function TogglePill({ label, active, onClick, disabled = false }: { label: string; active: boolean; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            className={active ? "spiir-pill-toggle active" : "spiir-pill-toggle"}
            aria-pressed={active}
            onClick={onClick}
            disabled={disabled}
        >
            {label}
        </button>
    );
}

function valueToneClass(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value) || value === 0) {
        return "spiir-neutral";
    }
    return value > 0 ? "spiir-positive" : "spiir-negative";
}

function slicePeriods(periods: string[], count: number): string[] {
    if (count <= 0 || periods.length <= count) {
        return periods;
    }
    return periods.slice(-count);
}

function visibleMonthPeriods(periods: string[], selection: string, excludeLatest: boolean): string[] {
    const skipLast = excludeLatest ? 1 : 0;
    const lastOverall = periods[periods.length - 1];
    if (selection.startsWith("y:")) {
        let next = periods.filter((period) => period.startsWith(`${selection.slice(2)}-`));
        if (skipLast && next.length > 0 && next[next.length - 1] === lastOverall) {
            next = next.slice(0, -1);
        }
        return next;
    }
    if (selection === "all") {
        return skipLast ? periods.slice(0, Math.max(0, periods.length - 1)) : periods;
    }
    const count = Number.parseInt(selection, 10) || 12;
    const next = slicePeriods(periods, count + skipLast);
    return skipLast ? next.slice(0, Math.max(0, next.length - 1)) : next;
}

function visibleYearPeriods(periods: string[], selection: string, excludeLatest: boolean): string[] {
    const base = excludeLatest ? periods.slice(0, Math.max(0, periods.length - 1)) : periods;
    if (selection === "all") {
        return base;
    }
    const count = Number.parseInt(selection, 10) || base.length;
    return base.slice(-count);
}

function previousWindow(allPeriods: string[], visiblePeriods: string[]): string[] {
    if (visiblePeriods.length === 0) {
        return [];
    }
    const firstIndex = allPeriods.indexOf(visiblePeriods[0]);
    if (firstIndex < visiblePeriods.length) {
        return [];
    }
    return allPeriods.slice(firstIndex - visiblePeriods.length, firstIndex);
}

function rowTotalForPeriods(row: SpiirOverviewRow, periods: string[]): number {
    return periods.reduce((sum, period) => sum + Number(row.values[period] ?? 0), 0);
}

function rowAvgForPeriods(row: SpiirOverviewRow, periods: string[]): number {
    if (periods.length === 0) {
        return 0;
    }
    return Math.round(rowTotalForPeriods(row, periods) / periods.length);
}

function rowHasNonZeroForPeriods(row: SpiirOverviewRow, periods: string[]): boolean {
    return periods.some((period) => Number(row.values[period] ?? 0) !== 0);
}

function signedSortValue(left: number, right: number): number {
    const leftPositive = left > 0;
    const rightPositive = right > 0;
    if (leftPositive && rightPositive) {
        return right - left;
    }
    if (leftPositive && !rightPositive) {
        return -1;
    }
    if (!leftPositive && rightPositive) {
        return 1;
    }
    return left - right;
}

function compareLocale(left: string | null | undefined, right: string | null | undefined): number {
    return String(left ?? "").localeCompare(String(right ?? ""), "da");
}

function filterVisibleHierarchy(rows: SpiirOverviewRow[], periods: string[]): SpiirOverviewRow[] {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const keep = new Set<string>();
    const alwaysKeep = new Set(["diff", "income", "expense", "investment", "hashtag"]);

    const markKeep = (row: SpiirOverviewRow): void => {
        let current: SpiirOverviewRow | undefined = row;
        while (current) {
            if (keep.has(current.key)) {
                return;
            }
            keep.add(current.key);
            current = current.parent ? byKey.get(current.parent) : undefined;
        }
    };

    rows.forEach((row) => {
        if (alwaysKeep.has(row.key) || rowHasNonZeroForPeriods(row, periods)) {
            markKeep(row);
        }
    });

    return rows.filter((row) => keep.has(row.key));
}

function sortHierarchyRows(
    rows: SpiirOverviewRow[],
    periods: string[],
    compareChildren: (left: SpiirOverviewRow, right: SpiirOverviewRow) => number
): SpiirOverviewRow[] {
    const filteredRows = filterVisibleHierarchy(rows, periods);
    const byParent = new Map<string | null, SpiirOverviewRow[]>();
    filteredRows.forEach((row) => {
        const parentKey = row.parent ?? null;
        const current = byParent.get(parentKey) ?? [];
        current.push(row);
        byParent.set(parentKey, current);
    });

    const rootOrder = new Map([
        ["diff", 0],
        ["income", 1],
        ["expense", 2],
        ["investment", 3],
        ["hashtag", 4]
    ]);

    const sortSiblings = (siblings: SpiirOverviewRow[], parentKey: string | null): SpiirOverviewRow[] => {
        if (parentKey === null) {
            return [...siblings].sort((left, right) => {
                const leftOrder = rootOrder.get(left.key);
                const rightOrder = rootOrder.get(right.key);
                if (leftOrder !== undefined || rightOrder !== undefined) {
                    return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
                }
                return compareLocale(left.label, right.label);
            });
        }
        return [...siblings].sort(compareChildren);
    };

    const flatten = (parentKey: string | null): SpiirOverviewRow[] => {
        const siblings = sortSiblings(byParent.get(parentKey) ?? [], parentKey);
        return siblings.flatMap((row) => [row, ...flatten(row.key)]);
    };

    return flatten(null);
}

function buildVisibleRows(rows: SpiirOverviewRow[], expandedRows: Set<string>): SpiirOverviewRow[] {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return rows.filter((row) => {
        if (!row.parent) {
            return true;
        }
        let parentKey: string | null = row.parent;
        while (parentKey) {
            if (!expandedRows.has(parentKey)) {
                return false;
            }
            parentKey = byKey.get(parentKey)?.parent ?? null;
        }
        return true;
    });
}

function buildHeatmapScale(rows: SpiirOverviewRow[], periods: string[]): Map<string, { pos: number; neg: number }> {
    const scale = new Map<string, { pos: number; neg: number }>();
    rows.forEach((row) => {
        if (!row.parent || (row.kind !== "main" && row.kind !== "sub")) {
            return;
        }
        const current = scale.get(row.parent) ?? { pos: 0, neg: 0 };
        periods.forEach((period) => {
            const value = Number(row.values[period] ?? 0);
            if (value > 0) {
                current.pos = Math.max(current.pos, value);
            }
            if (value < 0) {
                current.neg = Math.max(current.neg, Math.abs(value));
            }
        });
        scale.set(row.parent, current);
    });
    return scale;
}

function heatmapCellStyle(
    row: SpiirOverviewRow,
    value: number,
    heatmap: boolean,
    scale: Map<string, { pos: number; neg: number }>
): React.CSSProperties | undefined {
    if (!heatmap || !row.parent || (row.kind !== "main" && row.kind !== "sub") || value === 0) {
        return undefined;
    }
    const current = scale.get(row.parent);
    if (!current) {
        return undefined;
    }
    const divisor = value > 0 ? current.pos : current.neg;
    if (!divisor) {
        return undefined;
    }
    const alpha = Math.abs(value) / divisor * 0.24;
    const rgb = value > 0 ? "31, 107, 92" : "142, 59, 46";
    return { background: `rgba(${rgb}, ${Math.min(0.24, alpha)})` };
}

function buildPeriodChartSeries(visiblePeriods: string[], rows: SpiirOverviewRow[], level: ChartLevel): ChartSeries[] {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const getY = (row: SpiirOverviewRow | undefined): number[] => visiblePeriods.map((period) => Number(row?.values[period] ?? 0));
    const sumY = (values: number[]): number => values.reduce((sum, value) => sum + value, 0);
    const hasNonZero = (values: number[]): boolean => values.some((value) => value !== 0);
    const output: ChartSeries[] = [];
    const incomeRow = byKey.get("income");
    const expenseRow = byKey.get("expense");
    const diffRow = byKey.get("diff");

    if (level === "top") {
        return [
            { key: "income", label: "Income", kind: "income", y: getY(incomeRow), main: "" },
            { key: "expense", label: "Expense", kind: "expense_total", y: getY(expenseRow), main: "" },
            { key: "diff", label: "Diff", kind: "diff", y: getY(diffRow), main: "" }
        ];
    }

    const incomeParts = rows
        .filter((row) => row.kind === "sub" && row.parent === "income" && row.level === 1)
        .map((row) => ({ row, y: getY(row) }))
        .filter(({ y }) => hasNonZero(y))
        .map(({ row, y }) => ({
            key: row.key,
            label: row.label,
            kind: "income_part" as const,
            y,
            main: row.label,
            signed: sumY(y),
            absTotal: Math.abs(sumY(y))
        }))
        .sort((left, right) => signedSortValue(right.signed, left.signed) || right.absTotal - left.absTotal || compareLocale(left.label, right.label));

    if (incomeParts.length > 0) {
        const labels = incomeParts.map((part) => String(part.label)).sort(compareLocale);
        const hueByLabel = new Map(labels.map((label, index) => [label, INCOME_PART_HUES[index % INCOME_PART_HUES.length]]));
        incomeParts.forEach((part) => output.push({
            key: part.key,
            label: part.label,
            kind: part.kind,
            y: part.y,
            main: part.main,
            incomeHue: hueByLabel.get(String(part.label))
        }));
    } else {
        output.push({ key: "income", label: "Income", kind: "income", y: getY(incomeRow), main: "" });
    }

    const entries = rows
        .filter((row) => level === "main"
            ? row.kind === "main" && row.level === 1 && row.parent === "expense"
            : row.kind === "sub" && row.level === 2)
        .map((row) => ({
            row,
            y: getY(row),
            main: row.mainCategoryName || row.label,
            signed: sumY(getY(row)),
            absTotal: Math.abs(sumY(getY(row)))
        }))
        .filter(({ y }) => hasNonZero(y))
        .sort((left, right) => signedSortValue(right.signed, left.signed) || right.absTotal - left.absTotal || compareLocale(left.row.label, right.row.label));

    const mains = [...new Set(entries.map((entry) => String(entry.main)).filter(Boolean))].sort(compareLocale);
    const mainHue = new Map(mains.map((main, index) => [main, EXPENSE_MAIN_HUES[index % EXPENSE_MAIN_HUES.length]]));
    entries.forEach((entry) => output.push({
        key: entry.row.key,
        label: entry.row.label,
        kind: "expense",
        y: entry.y,
        main: entry.main,
        expenseHue: mainHue.get(String(entry.main))
    }));

    return output;
}

function buildPeriodChartFigure(
    section: SpiirOverviewResponse["monthly"] | SpiirOverviewResponse["yearly"],
    visiblePeriods: string[],
    periodKind: PeriodKind,
    options: ChartOptions,
    hiddenTopSeries: Set<string> = new Set()
): { data: object[]; layout: object } {
    const series = buildPeriodChartSeries(visiblePeriods, section.rows, options.level);
    const accumulate = (values: number[]): number[] => {
        let running = 0;
        return values.map((value) => {
            running += value;
            return running;
        });
    };

    if (periodKind === "month" && options.level === "top") {
        const topTraces = series
            .filter((entry) => !hiddenTopSeries.has(entry.key))
            .map((entry) => {
                const isIncome = entry.key === "income";
                const isExpense = entry.key === "expense";
                const color = isIncome ? "#09ab58" : isExpense ? "#e45b55" : "#1687a7";
                if (entry.key === "diff") {
                    return {
                        type: "scatter",
                        mode: "lines+markers",
                        name: entry.label,
                        x: visiblePeriods,
                        y: entry.y,
                        line: { color, width: 3 },
                        marker: { color, size: 7, line: { color: "#f4fbf6", width: 1 } },
                        hovertemplate: "%{fullData.name} · %{y:,.0f} kr<extra></extra>",
                    };
                }
                return {
                    type: "bar",
                    name: entry.label,
                    x: visiblePeriods,
                    y: entry.y,
                    width: entry.key === "diff" ? 0.18 : 0.58,
                    opacity: entry.key === "diff" ? 0.95 : 0.78,
                    marker: { color, line: { width: 0 } },
                    hovertemplate: "%{fullData.name} · %{y:,.0f} kr<extra></extra>",
                };
            });
        return {
            data: topTraces,
            layout: {
                margin: { l: 72, r: 20, t: 24, b: 52 },
                height: 480,
                showlegend: false,
                hovermode: "x unified",
                hoverlabel: { bgcolor: "#101a14", bordercolor: "#2c8b5e", font: { color: "#f4fbf6", size: 13 } },
                barmode: "overlay",
                bargap: 0.22,
                xaxis: {
                    type: "category",
                    automargin: true,
                    showgrid: false,
                    fixedrange: true,
                    showspikes: false,
                    tickmode: "array",
                    tickvals: visiblePeriods.length > 10
                        ? visiblePeriods.filter((_, index) => index % 2 === 0 || index === visiblePeriods.length - 1)
                        : visiblePeriods,
                },
                yaxis: {
                    title: "DKK",
                    zeroline: true,
                    zerolinewidth: 2,
                    automargin: true,
                    tickformat: ",.0f",
                    fixedrange: true,
                },
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
            },
        };
    }

    const traces = series.map((entry) => {
        const y = options.cumulative ? accumulate(entry.y) : entry.y;
        const isIncome = entry.kind === "income";
        const isIncomePart = entry.kind === "income_part";
        const isDiff = entry.kind === "diff";
        const isExpense = entry.kind === "expense" || entry.kind === "expense_total";

        let color = "rgba(143, 122, 72, 0.9)";
        if (isIncome) {
            color = "rgba(31, 107, 92, 0.9)";
        } else if (isIncomePart) {
            color = incomePartColorFromHue(Number(entry.incomeHue ?? INCOME_PART_HUES[0]), entry.label, 0.86);
        } else if (isDiff) {
            color = "rgba(143, 122, 72, 0.95)";
        } else if (entry.kind === "expense_total") {
            color = "rgba(142, 59, 46, 0.88)";
        } else if (options.level === "main") {
            color = expenseMainColorFromHue(Number(entry.expenseHue ?? EXPENSE_MAIN_HUES[0]), 0.84, 60);
        } else {
            color = expenseSubColorFromHue(Number(entry.expenseHue ?? EXPENSE_MAIN_HUES[0]), entry.label, 0.76);
        }

        if (options.bars) {
            return {
                type: "bar",
                name: entry.label,
                x: visiblePeriods,
                y,
                marker: { color, line: { color: "rgba(255,255,255,0.2)", width: 1 } },
                hovertemplate: "%{fullData.name} | %{y:,.0f}<extra></extra>"
            };
        }

        const doStackExpenses = options.stacked && isExpense && !isDiff && entry.kind !== "expense_total" && options.level !== "top";
        const doStackIncome = options.stacked && isIncomePart && options.level !== "top";
        return {
            type: "scatter",
            mode: "lines+markers",
            name: entry.label,
            x: visiblePeriods,
            y,
            line: { color, width: isDiff ? 3.2 : 2.6 },
            marker: { color, size: 7 },
            stackgroup: doStackExpenses ? "exp" : doStackIncome ? "inc" : undefined,
            fill: doStackExpenses || doStackIncome ? "tonexty" : "none",
            hovertemplate: "%{fullData.name} | %{y:,.0f}<extra></extra>"
        };
    });

    return {
        data: traces,
        layout: {
            title: {
                text: periodKind === "year"
                    ? `År: ${visiblePeriods[0] ?? ""}-${visiblePeriods[visiblePeriods.length - 1] ?? ""}`
                    : `Måneder: ${visiblePeriods[0] ?? ""}-${visiblePeriods[visiblePeriods.length - 1] ?? ""}`,
                font: { size: 13 }
            },
            margin: { l: 64, r: 12, t: 42, b: 66 },
            height: 520,
            showlegend: true,
            legend: { orientation: "h", x: 0, xanchor: "left", y: -0.22, yanchor: "top" },
            hovermode: "x unified",
            hoverlabel: { bgcolor: "#101a14", bordercolor: "#2c8b5e", font: { color: "#f4fbf6", size: 13 } },
            barmode: options.bars && options.stacked && options.level !== "top" ? "relative" : options.bars ? "group" : undefined,
            bargap: options.bars ? 0.18 : undefined,
            xaxis: {
                tickangle: 0,
                automargin: true,
                showspikes: false,
                tickmode: "array",
                tickvals: periodKind === "month" && visiblePeriods.length > 10
                    ? visiblePeriods.filter((_, index) => index % 2 === 0 || index === visiblePeriods.length - 1)
                    : visiblePeriods
            },
            yaxis: {
                rangemode: "tozero",
                automargin: true,
                tickformat: ",.0f"
            },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)"
        }
    };
}

function transactionMatchesOverviewRow(transaction: SpiirTransaction, row: SpiirOverviewRow): boolean {
    if (row.key === "diff") return ["Income", "Expense"].includes(String(transaction.categoryType ?? ""));
    if (row.key === "cashflow") return ["Income", "Expense", "Investment"].includes(String(transaction.categoryType ?? ""));
    if (row.key === "income") return transaction.categoryType === "Income";
    if (row.key === "expense") return transaction.categoryType === "Expense";
    if (row.key === "investment") return transaction.categoryType === "Investment";
    if (row.kind === "main") return transaction.mainCategoryName === row.mainCategoryName;
    if (row.kind === "sub") return String(transaction.categoryId ?? "") === String(row.categoryId ?? "");
    return false;
}

function comparableTransactionTotal(
    transactions: SpiirTransaction[] | null,
    row: SpiirOverviewRow | null,
    periods: string[],
    cutoffDay: number | null,
): number | null {
    if (!transactions || !row || periods.length === 0) return null;
    const periodSet = new Set(periods);
    const lastPeriod = periods[periods.length - 1];
    const cutoffDate = cutoffDay === null ? null : `${lastPeriod}-${String(cutoffDay).padStart(2, "0")}`;
    return transactions.reduce((sum, transaction) => {
        const month = String(transaction.yyyymm ?? transaction.ymd?.slice(0, 7) ?? "");
        if (!periodSet.has(month) || (cutoffDate && month === lastPeriod && transaction.ymd > cutoffDate)) return sum;
        return transactionMatchesOverviewRow(transaction, row) ? sum + Number(transaction.amount ?? 0) : sum;
    }, 0);
}

function monthEndDate(month: string): string {
    const [year, monthNumber] = month.split("-").map((part) => Number(part));
    const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return `${month}-${String(day).padStart(2, "0")}`;
}

function periodFilterForDrilldown(periods: string[], kind: PeriodKind): Pick<LedgerDrilldownFilter, "periodFilter" | "periodStart" | "periodEnd"> {
    if (periods.length === 1) {
        return { periodFilter: kind === "year" ? `year:${periods[0]}` : `month:${periods[0]}` };
    }
    const sortedPeriods = [...periods].sort();
    const firstPeriod = sortedPeriods[0];
    const lastPeriod = sortedPeriods[sortedPeriods.length - 1];
    if (kind === "year") {
        return { periodFilter: "custom", periodStart: `${firstPeriod}-01-01`, periodEnd: `${lastPeriod}-12-31` };
    }
    return { periodFilter: "custom", periodStart: `${firstPeriod}-01`, periodEnd: monthEndDate(lastPeriod) };
}

function categoryOptionFromOverviewRow(row: SpiirOverviewRow): LedgerCategoryOption | null {
    if (row.kind === "sub" && row.categoryId !== null && row.categoryId !== undefined) {
        return {
            categoryType: row.categoryType || "Expense",
            mainCategoryId: row.mainCategoryId ?? "",
            mainCategoryName: row.mainCategoryName || "Diverse",
            categoryId: row.categoryId,
            categoryName: row.categoryName || row.label,
            usage_count: 0,
        };
    }
    if (row.kind === "main" && row.mainCategoryId !== null && row.mainCategoryId !== undefined) {
        return {
            categoryType: row.categoryType || "Expense",
            mainCategoryId: row.mainCategoryId,
            mainCategoryName: row.mainCategoryName || row.label,
            categoryId: `__main__::${String(row.mainCategoryId)}`,
            categoryName: row.mainCategoryName || row.label,
            usage_count: 0,
        };
    }
    return null;
}

function drilldownFilterFromOverviewRow(row: SpiirOverviewRow, periods: string[], kind: PeriodKind): LedgerDrilldownFilter {
    const categoryFilter = categoryOptionFromOverviewRow(row);
    const period = periodFilterForDrilldown(periods, kind);
    if (row.kind === "income") {
        return { title: "", ...period, visibilityFilter: "income", categoryFilter: null };
    }
    if (row.kind === "expense") {
        return { title: "", ...period, visibilityFilter: "expense", categoryFilter: null };
    }
    if (row.kind === "investment") {
        return { title: "", ...period, visibilityFilter: "investment", categoryFilter: null };
    }
    if (row.kind === "diff") {
        return { title: "", ...period, visibilityFilter: "operating", categoryFilter: null };
    }
    if (row.kind === "cashflow") {
        return { title: "", ...period, visibilityFilter: "cashflow", categoryFilter: null };
    }
    if (row.kind === "hashtag_item" && row.hashtag) {
        return { title: "", ...period, visibilityFilter: "all", categoryFilter: null, searchText: String(row.hashtag) };
    }
    if (row.kind === "hashtag") {
        return { title: "", ...period, visibilityFilter: "all", categoryFilter: null, searchText: "#" };
    }
    return {
        title: "",
        ...period,
        visibilityFilter: categoryFilter ? "category" : row.kind === "expense" ? "consumption" : "all",
        categoryFilter,
    };
}

function finishedCurrentYearPeriods(periods: string[], now = new Date()): string[] {
    const year = String(now.getFullYear());
    const currentMonth = now.getMonth() + 1;
    return periods.filter((period) => {
        if (!period.startsWith(`${year}-`)) {
            return false;
        }
        const month = Number(period.slice(5, 7));
        return Number.isInteger(month) && month >= 1 && month < currentMonth;
    });
}

function projectedYearTotal(row: SpiirOverviewRow, monthlyRows: SpiirOverviewRow[], periods: string[]): number | null {
    if (periods.length === 0) {
        return null;
    }
    const monthlyRow = monthlyRows.find((candidate) => candidate.key === row.key) ?? row;
    return Math.round(rowTotalForPeriods(monthlyRow, periods) * 12 / periods.length);
}

function categoryOptionFromTransactions(items: SpiirTransaction[]): LedgerCategoryOption | null {
    const first = items[0];
    if (!first || first.categoryId === null || first.categoryId === undefined) {
        return null;
    }
    const sameCategory = items.every((item) => String(item.categoryId ?? "") === String(first.categoryId ?? "") && String(item.mainCategoryId ?? "") === String(first.mainCategoryId ?? ""));
    if (!sameCategory) {
        return null;
    }
    return {
        categoryType: first.categoryType || "Expense",
        mainCategoryId: first.mainCategoryId ?? "",
        mainCategoryName: first.mainCategoryName || "Diverse",
        categoryId: first.categoryId,
        categoryName: first.categoryName || "Ikke kategoriseret",
        usage_count: 0,
    };
}

function periodFilterFromTransactions(items: SpiirTransaction[]): LedgerDrilldownFilter["periodFilter"] {
    const months = [...new Set(items.map((item) => item.yyyymm).filter(Boolean))];
    if (months.length === 1) {
        return `month:${months[0]}`;
    }
    const years = [...new Set(items.map((item) => item.year).filter(Boolean))];
    return years.length === 1 ? `year:${years[0]}` : "all";
}

type OverviewSectionProps = {
    title: string;
    section: SpiirOverviewResponse["monthly"] | SpiirOverviewResponse["yearly"];
    periodKind: PeriodKind;
    visiblePeriods: string[];
    prevPeriods: string[];
    expandedRows: Set<string>;
    onToggle: (key: string) => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    heatmap: boolean;
    showPrevTotals: boolean;
    projection: { year: string; periods: string[]; monthlyRows: SpiirOverviewRow[] } | null;
    onOpenDrilldown: (row: SpiirOverviewRow, title: string, periods: string[], kind: PeriodKind) => void;
    onOpenSunburst: (title: string, periods: string[], mode: SunburstMode, rows: SpiirOverviewRow[]) => void;
};

function OverviewSection({
    title,
    section,
    periodKind,
    visiblePeriods,
    prevPeriods,
    expandedRows,
    onToggle,
    onExpandAll,
    onCollapseAll,
    heatmap,
    showPrevTotals,
    projection,
    onOpenDrilldown,
    onOpenSunburst
}: OverviewSectionProps) {
    const orderedRows = useMemo(
        () => sortHierarchyRows(section.rows, visiblePeriods, (left, right) => compareLocale(left.label, right.label)),
        [section.rows, visiblePeriods]
    );
    const visibleRows = useMemo(() => buildVisibleRows(orderedRows, expandedRows), [expandedRows, orderedRows]);
    const heatmapScale = useMemo(() => buildHeatmapScale(orderedRows, visiblePeriods), [orderedRows, visiblePeriods]);
    const expandableKeys = useMemo(
        () => orderedRows.filter((row) => hasChildren(orderedRows, row.key)).map((row) => row.key),
        [orderedRows]
    );
    const allExpanded = expandableKeys.length > 0 && expandableKeys.every((key) => expandedRows.has(key));
    const showProjection = periodKind === "year" && projection !== null;

    return (
        <section className="panel spiir-panel">
            <div className="spiir-table-scroll">
                <table className="spiir-table">
                    <thead>
                        <tr>
                            <th className="spiir-sticky">
                                <button
                                    type="button"
                                    className="spiir-pill-toggle spiir-table-expand-pill"
                                    onClick={allExpanded ? onCollapseAll : onExpandAll}
                                >
                                    {allExpanded ? "Collapse" : "Expand"}
                                </button>
                            </th>
                            {visiblePeriods.map((period) => (
                                <th key={period}>
                                    <button
                                        type="button"
                                        className="spiir-th-button"
                                        onClick={() => onOpenSunburst(`${title} · ${period}`, [period], periodKind === "year" ? "years" : "months", section.rows)}
                                    >
                                        {period}
                                    </button>
                                </th>
                            ))}
                            {showProjection ? <th>Proj. {projection.year}</th> : null}
                            <th>
                                <button
                                    type="button"
                                    className="spiir-th-button spiir-th-button-right"
                                    onClick={() => onOpenSunburst(`${title} · Total`, visiblePeriods, periodKind === "year" ? "years" : "months", section.rows)}
                                >
                                    I alt
                                </button>
                            </th>
                            <th>Snit</th>
                            {showPrevTotals ? <th>Prev total</th> : null}
                            {showPrevTotals ? <th>Δ total</th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.map((row) => {
                            const expandable = hasChildren(orderedRows, row.key);
                            const total = rowTotalForPeriods(row, visiblePeriods);
                            const avg = rowAvgForPeriods(row, visiblePeriods);
                            const prevTotal = rowTotalForPeriods(row, prevPeriods);
                            const delta = total - prevTotal;
                            const projected = showProjection && projection
                                ? projectedYearTotal(row, projection.monthlyRows, projection.periods)
                                : null;
                            return (
                                <tr key={row.key} className={`spiir-row spiir-level-${row.level}${row.key === "investment" || row.parent === "investment" ? " spiir-investment-row" : ""}`}>
                                    <td className="spiir-sticky spiir-label-cell">
                                        <div className="spiir-label-wrap">
                                            {expandable ? (
                                                <button type="button" className="spiir-expand-toggle" onClick={() => onToggle(row.key)}>
                                                    {expandedRows.has(row.key) ? "−" : "+"}
                                                </button>
                                            ) : null}
                                            <span className="spiir-label-text" title={row.label}>{row.label}</span>
                                        </div>
                                    </td>
                                    {visiblePeriods.map((period) => {
                                        const value = Number(row.values[period] ?? 0);
                                        return (
                                            <td key={`${row.key}-${period}`} style={heatmapCellStyle(row, value, heatmap, heatmapScale)}>
                                                <button
                                                    type="button"
                                                    className={`spiir-cell-button ${valueToneClass(value)}`}
                                                    onClick={() => onOpenDrilldown(row, `${row.label} · ${period}`, [period], periodKind)}
                                                >
                                                    {formatNumber(value)}
                                                </button>
                                            </td>
                                        );
                                    })}
                                    {showProjection ? (
                                        <td>
                                            {projected === null ? (
                                                <span className="spiir-muted-cell">-</span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={`spiir-cell-button spiir-cell-button-right ${valueToneClass(projected)}`}
                                                    onClick={() => onOpenDrilldown(row, `${row.label} · ${projection?.year} projection`, projection?.periods ?? [], "month")}
                                                >
                                                    {formatNumber(projected)}
                                                </button>
                                            )}
                                        </td>
                                    ) : null}
                                    <td>
                                        <button
                                            type="button"
                                            className={`spiir-cell-button spiir-cell-button-right ${valueToneClass(total)}`}
                                            onClick={() => onOpenDrilldown(row, `${row.label} · ${visiblePeriods[0]}-${visiblePeriods[visiblePeriods.length - 1]}`, visiblePeriods, periodKind)}
                                        >
                                            {formatNumber(total)}
                                        </button>
                                    </td>
                                    <td className="spiir-muted-cell">{formatNumber(avg)}</td>
                                    {showPrevTotals ? (
                                        <td>
                                            {prevPeriods.length > 0 ? (
                                                <button
                                                    type="button"
                                                    className="spiir-cell-button spiir-cell-button-right spiir-muted-cell"
                                                    onClick={() => onOpenDrilldown(row, `${row.label} · ${prevPeriods[0]}-${prevPeriods[prevPeriods.length - 1]}`, prevPeriods, periodKind)}
                                                >
                                                    {formatNumber(prevTotal)}
                                                </button>
                                            ) : (
                                                <span className="spiir-muted-cell">-</span>
                                            )}
                                        </td>
                                    ) : null}
                                    {showPrevTotals ? (
                                        <td>
                                            {prevPeriods.length > 0 ? (
                                                <button
                                                    type="button"
                                                    className={`spiir-cell-button spiir-cell-button-right ${valueToneClass(delta)}`}
                                                    onClick={() => onOpenDrilldown(row, `${row.label} · Delta`, visiblePeriods, periodKind)}
                                                >
                                                    {formatNumber(delta)}
                                                </button>
                                            ) : (
                                                <span className="spiir-muted-cell">-</span>
                                            )}
                                        </td>
                                    ) : null}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function businessDelta(current: number, previous: number): number | null {
    if (previous === 0) {
        return null;
    }
    return ((current - previous) / Math.abs(previous)) * 100;
}

function formatBusinessValue(value: number): string {
    return formatWholeDkk(value);
}

function formatBusinessDelta(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
        return "No prior baseline";
    }
    return `${value >= 0 ? "+" : ""}${formatOneDecimal(value)}% vs prior year`;
}

type SpendingSource = {
    key: string;
    label: string;
    searchText: string;
    category: string;
    subcategory: string;
    spend: number;
    previousSpend: number;
    count: number;
    monthCount: number;
    average: number;
    share: number;
    cadence: "Recurring" | "Frequent" | "Occasional";
    change: number | null;
};

type SpendingSubcategory = {
    key: string;
    label: string;
    category: string;
    spend: number;
    share: number;
};

const SPENDING_SOURCE_ALIASES: Array<[RegExp, string, string]> = [
    [/p\.\s*g\.\s*administration/i, "P.G. Administration", "P. G. ADMINISTRATION"],
    [/københavns kommune/i, "Københavns Kommune", "Københavns Kommune"],
    [/akademikernes a-kasse/i, "Akademikernes A-kasse", "AKADEMIKERNES A-KASSE"],
    [/frie skolers lærerforening/i, "Frie Skolers Lærerforening", "FRIE SKOLERS LÆRERFORENING"],
    [/adm\.service fyn/i, "ADM. Service Fyn", "ADM.SERVICE FYN"],
    [/scalepoint/i, "Scalepoint", "Scalepoint"],
    [/babysam/i, "BabySam", "babysam"],
    [/rejsekort/i, "Rejsekort", "Rejsekort"],
    [/sygeforsikringen/i, "Sygeforsikringen Danmark", "Sygeforsikringen"],
    [/sansefys/i, "Sansefys", "Sansefys"],
    [/slyngejordemoder/i, "Slyngejordemoder", "Slyngejordemoder"],
    [/wolt/i, "Wolt", "Wolt"],
    [/aarstiderne/i, "Aarstiderne", "AARSTIDERNE"],
    [/netto/i, "Netto", "Netto"],
    [/rema\s*1000/i, "Rema 1000", "REMA1000"],
    [/føtex/i, "Føtex", "føtex"],
    [/coop/i, "Coop", "Coop"],
    [/rente af gæld/i, "Mortgage interest", "Rente af gæld"],
    [/provision af maksimum/i, "Mortgage credit fee", "Provision af maksimum"],
];

function spendingSourceIdentity(transaction: SpiirTransaction): { key: string; label: string; searchText: string } {
    const original = String(transaction.description ?? "").trim();
    const normalizedOriginal = original.normalize("NFKC");
    for (const [pattern, label, searchText] of SPENDING_SOURCE_ALIASES) {
        if (pattern.test(normalizedOriginal)) return { key: label.toLocaleLowerCase("da"), label, searchText };
    }
    let label = normalizedOriginal
        .replace(/^(?:kontaktløs\s+)?(?:visa\/)?dankort(?:-køb)?\s+/i, "")
        .replace(/^betalingsservice\s+/i, "")
        .replace(/^mobilepay(?:\s+køb)?\s+(?:mobilepay\s+)?/i, "")
        .replace(/^mobilepay:\s*(?:mobilepay\s+)?/i, "")
        .replace(/\s+(?:aftalenr\.|nota(?:nr\.|\s+nr\.)?|notanr)\s+.*$/i, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    if (!label || label.length < 2 || /^(?:advis|kortkøb|køb)$/i.test(label)) {
        label = String(transaction.categoryName ?? transaction.mainCategoryName ?? "Other spending");
    }
    if (label.length > 42) label = `${label.slice(0, 39).trim()}…`;
    const searchText = label.replace(/…$/, "").split(/[,/]/)[0].trim();
    return { key: `${String(transaction.mainCategoryName ?? "Diverse").toLocaleLowerCase("da")}|${label.toLocaleLowerCase("da")}`, label, searchText };
}

function buildSpendingSources(
    transactions: SpiirTransaction[] | null,
    periods: string[],
    previousPeriods: string[],
    categoryFilter: string,
    subcategoryFilter = "",
): SpendingSource[] {
    if (!transactions || periods.length === 0) return [];
    const currentSet = new Set(periods);
    const previousSet = new Set(previousPeriods);
    const groups = new Map<string, Omit<SpendingSource, "average" | "share" | "cadence" | "change"> & { months: Set<string> }>();
    for (const transaction of transactions) {
        if (transaction.categoryType !== "Expense" || Number(transaction.amount ?? 0) >= 0) continue;
        const category = String(transaction.mainCategoryName ?? "Diverse");
        const subcategory = String(transaction.categoryName ?? "Ikke kategoriseret");
        if (category === "Vis ikke" || (categoryFilter && category !== categoryFilter) || (subcategoryFilter && subcategory !== subcategoryFilter)) continue;
        const month = String(transaction.yyyymm ?? transaction.ymd?.slice(0, 7) ?? "");
        if (!currentSet.has(month) && !previousSet.has(month)) continue;
        const identity = spendingSourceIdentity(transaction);
        const groupKey = `${category}|${subcategory}|${identity.key}`;
        const group = groups.get(groupKey) ?? {
            key: groupKey,
            label: identity.label,
            searchText: identity.searchText,
            category,
            subcategory,
            spend: 0,
            previousSpend: 0,
            count: 0,
            monthCount: 0,
            months: new Set<string>(),
        };
        if (currentSet.has(month)) {
            group.spend += Math.abs(Number(transaction.amount ?? 0));
            group.count += 1;
            group.months.add(month);
        } else {
            group.previousSpend += Math.abs(Number(transaction.amount ?? 0));
        }
        groups.set(groupKey, group);
    }
    const totalSpend = [...groups.values()].reduce((sum, group) => sum + group.spend, 0);
    return [...groups.values()]
        .filter((group) => group.spend > 0)
        .map((group) => {
            const monthCount = group.months.size;
            const coverage = monthCount / Math.max(periods.length, 1);
            const cadence: SpendingSource["cadence"] = coverage >= 0.55 && monthCount >= 3 ? "Recurring" : group.count / Math.max(periods.length, 1) >= 2 ? "Frequent" : "Occasional";
            const { months: _months, ...source } = group;
            return {
                ...source,
                monthCount,
                average: group.spend / Math.max(group.count, 1),
                share: totalSpend ? (group.spend / totalSpend) * 100 : 0,
                cadence,
                change: businessDelta(group.spend, group.previousSpend),
            };
        })
        .sort((left, right) => right.spend - left.spend);
}

function BusinessReview({
    section,
    transactions,
    onOpenDrilldown,
    onOpenSpendingSource,
}: {
    section: SpiirOverviewResponse["monthly"];
    transactions: SpiirTransaction[] | null;
    onOpenDrilldown: (row: SpiirOverviewRow, title: string, periods: string[]) => void;
    onOpenSpendingSource: (title: string, searchText: string, periods: string[]) => void;
}) {
    const years = useMemo(() => [...new Set(section.periods.map((period) => period.slice(0, 4)))].sort(), [section.periods]);
    const [selectedYear, setSelectedYear] = useState("");
    const [summaryMode, setSummaryMode] = useState<"total" | "average">("total");
    const [spendingCategory, setSpendingCategory] = useState("");
    const [spendingSubcategory, setSpendingSubcategory] = useState("");
    const [showAllSpendingSources, setShowAllSpendingSources] = useState(false);
    const [spendingTreemapFullscreen, setSpendingTreemapFullscreen] = useState(false);

    useEffect(() => {
        if (!selectedYear || (!years.includes(selectedYear) && selectedYear !== "last_12")) {
            setSelectedYear(years[years.length - 1] ?? "");
        }
    }, [selectedYear, years]);

    useEffect(() => {
        if (!spendingTreemapFullscreen) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSpendingTreemapFullscreen(false);
        };
        document.body.classList.add("spending-treemap-open");
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.classList.remove("spending-treemap-open");
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [spendingTreemapFullscreen]);

    const isLTM = selectedYear === "last_12";
    const yearIndex = years.indexOf(selectedYear);
    
    let currentPeriods: string[] = [];
    let previousPeriods: string[] = [];
    let compareYear = "";

    const today = new Date();
    if (isLTM) {
        compareYear = "Prior 12 months";
        for (let i = 12; i > 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
            currentPeriods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
            const pd = new Date(today.getFullYear() - 1, today.getMonth() - i + 1, 1);
            previousPeriods.push(`${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`);
        }
        currentPeriods = currentPeriods.filter((p) => section.periods.includes(p));
        const prevHasAll = previousPeriods.every((p) => section.periods.includes(p));
        if (!prevHasAll) {
            previousPeriods = [];
            compareYear = "";
        }
    } else {
        compareYear = yearIndex > 0 ? years[yearIndex - 1] : "";
        currentPeriods = section.periods.filter((period) => period.startsWith(`${selectedYear}-`));
        const monthCount = currentPeriods.length;
        previousPeriods = section.periods.filter((period) => period.startsWith(`${compareYear}-`)).slice(0, monthCount);
    }
    const isLiveYear = selectedYear === String(today.getFullYear());
    const comparableCutoffDay = isLiveYear ? today.getDate() : null;
    const incomeRow = section.rows.find((row) => row.key === "income") ?? null;
    const expenseRow = section.rows.find((row) => row.key === "expense") ?? null;
    const investmentRow = section.rows.find((row) => row.key === "investment") ?? null;
    const diffRow = section.rows.find((row) => row.key === "diff") ?? null;
    const cashFlowRow = diffRow ? { ...diffRow, key: "cashflow", kind: "cashflow", label: "Cash after investing" } : null;
    const liveMonth = `${selectedYear}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const latestCurrentPeriod = currentPeriods[currentPeriods.length - 1] ?? "";
    const latestMonthIncome = comparableTransactionTotal(transactions, incomeRow, [latestCurrentPeriod], null)
        ?? Number(incomeRow?.values[latestCurrentPeriod] ?? 0);
    const holdUnpaidLiveMonth = !isLTM && isLiveYear && latestCurrentPeriod === liveMonth && latestMonthIncome <= 0;
    const reportingCurrentPeriods = holdUnpaidLiveMonth ? currentPeriods.slice(0, -1) : currentPeriods;
    const reportingPreviousPeriods = previousPeriods.slice(0, reportingCurrentPeriods.length);

    const currentIncome = comparableTransactionTotal(transactions, incomeRow, reportingCurrentPeriods, null) ?? (incomeRow ? rowTotalForPeriods(incomeRow, reportingCurrentPeriods) : 0);
    const previousIncome = comparableTransactionTotal(transactions, incomeRow, reportingPreviousPeriods, null) ?? (incomeRow ? rowTotalForPeriods(incomeRow, reportingPreviousPeriods) : 0);
    const currentExpense = Math.abs(comparableTransactionTotal(transactions, expenseRow, reportingCurrentPeriods, null) ?? (expenseRow ? rowTotalForPeriods(expenseRow, reportingCurrentPeriods) : 0));
    const previousExpense = Math.abs(comparableTransactionTotal(transactions, expenseRow, reportingPreviousPeriods, null) ?? (expenseRow ? rowTotalForPeriods(expenseRow, reportingPreviousPeriods) : 0));
    const currentInvestment = Math.abs(comparableTransactionTotal(transactions, investmentRow, reportingCurrentPeriods, null) ?? (investmentRow ? rowTotalForPeriods(investmentRow, reportingCurrentPeriods) : 0));
    const previousInvestment = Math.abs(comparableTransactionTotal(transactions, investmentRow, reportingPreviousPeriods, null) ?? (investmentRow ? rowTotalForPeriods(investmentRow, reportingPreviousPeriods) : 0));
    const currentOperatingSurplus = currentIncome - currentExpense;
    const previousOperatingSurplus = previousIncome - previousExpense;
    const currentNet = currentOperatingSurplus - currentInvestment;
    const previousNet = previousOperatingSurplus - previousInvestment;
    const savingsRate = currentIncome ? (currentOperatingSurplus / currentIncome) * 100 : 0;
    const previousSavingsRate = previousIncome ? (previousOperatingSurplus / previousIncome) * 100 : 0;
    const monthLabels = currentPeriods.map((period) => new Intl.DateTimeFormat("da-DK", { month: "short" }).format(new Date(`${period}-01T00:00:00`)));
    const comparableMonthValue = (row: SpiirOverviewRow | null, period: string, absolute = false): number => {
        const isLastComparedMonth = period === currentPeriods[currentPeriods.length - 1] || period === previousPeriods[previousPeriods.length - 1];
        const total = comparableTransactionTotal(transactions, row, [period], isLastComparedMonth ? comparableCutoffDay : null)
            ?? Number(row?.values[period] ?? 0);
        return absolute ? Math.abs(total) : total;
    };
    const currentIncomeByMonth = currentPeriods.map((period) => comparableMonthValue(incomeRow, period));
    const previousIncomeByMonth = previousPeriods.map((period) => comparableMonthValue(incomeRow, period));
    const currentExpenseByMonth = currentPeriods.map((period) => comparableMonthValue(expenseRow, period, true));
    const previousExpenseByMonth = previousPeriods.map((period) => comparableMonthValue(expenseRow, period, true));
    const currentInvestmentByMonth = currentPeriods.map((period) => comparableMonthValue(investmentRow, period, true));
    const previousInvestmentByMonth = previousPeriods.map((period) => comparableMonthValue(investmentRow, period, true));

    const fullYearPeriods = isLTM ? currentPeriods : Array.from({ length: 12 }, (_, i) => `${selectedYear || "2000"}-${String(i + 1).padStart(2, "0")}`);
    const fullYearPreviousPeriods = isLTM ? previousPeriods : Array.from({ length: 12 }, (_, i) => `${compareYear || "2000"}-${String(i + 1).padStart(2, "0")}`);
    const fullYearMonthLabels = fullYearPeriods.map((period) => new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(`${period}-01T00:00:00`)));

    let runningCurrent = 0;
    const fullYearCurrentCumulative = fullYearPeriods.map((period) => {
        if (currentPeriods.includes(period)) {
            const income = comparableMonthValue(incomeRow, period);
            const expense = comparableMonthValue(expenseRow, period, true);
            const inv = comparableMonthValue(investmentRow, period, true);
            runningCurrent += (income - expense - inv);
            return runningCurrent;
        }
        return null;
    });

    let runningPrev = 0;
    const fullYearPreviousCumulative = fullYearPreviousPeriods.map((period) => {
        if (period && section.periods.includes(period)) {
            const income = comparableMonthValue(incomeRow, period);
            const expense = comparableMonthValue(expenseRow, period, true);
            const inv = comparableMonthValue(investmentRow, period, true);
            runningPrev += (income - expense - inv);
            return runningPrev;
        }
        return null;
    });

    const cumulative = (values: number[]) => {
        let total = 0;
        return values.map((value) => (total += value));
    };
    const currentNetByMonth = currentIncomeByMonth.map((income, index) => income - currentExpenseByMonth[index] - currentInvestmentByMonth[index]);
    const previousNetByMonth = previousIncomeByMonth.map((income, index) => income - previousExpenseByMonth[index] - previousInvestmentByMonth[index]);

    const incomeCategoryRows = section.rows
        .filter((row) => row.kind === "main" && row.parent === "income")
        .map((row) => ({
            row,
            current: comparableTransactionTotal(transactions, row, reportingCurrentPeriods, null) ?? rowTotalForPeriods(row, reportingCurrentPeriods),
        }))
        .filter((item) => item.current > 0)
        .sort((left, right) => right.current - left.current);
    const expenseCategoryRows = section.rows
        .filter((row) => row.kind === "main" && row.parent === "expense")
        .map((row) => ({
            row,
            current: Math.abs(comparableTransactionTotal(transactions, row, reportingCurrentPeriods, null) ?? rowTotalForPeriods(row, reportingCurrentPeriods)),
            previous: Math.abs(comparableTransactionTotal(transactions, row, reportingPreviousPeriods, null) ?? rowTotalForPeriods(row, reportingPreviousPeriods)),
        }))
        .filter((item) => item.current > 0 || item.previous > 0)
        .sort((left, right) => right.current - left.current);
    const categoryRows = expenseCategoryRows.slice(0, 8);

    const sharedLayout = {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { family: "Inter, Avenir Next, Segoe UI, sans-serif", color: "#607069", size: 12 },
        margin: { l: 68, r: 24, t: 32, b: 52 },
        hovermode: "x unified" as const,
        showlegend: true,
        legend: { orientation: "h", x: 0, y: 1.16, font: { size: 11 } },
        hoverlabel: { bgcolor: "#101a14", bordercolor: "#2c8b5e", font: { color: "#f4fbf6", size: 13 } },
    };

    const modernXAxis = { showgrid: false, zeroline: false, showspikes: false, tickfont: { color: "#718078" }, fixedrange: true };
    const modernYAxis = { title: "DKK", tickformat: ",.0f", gridcolor: "#e5ece8", gridwidth: 1, zeroline: true, zerolinecolor: "#cbd7d0", fixedrange: true };
    const currentMonthDivisor = Math.max(reportingCurrentPeriods.length, 1);
    const previousMonthDivisor = Math.max(reportingPreviousPeriods.length, 1);
    const summaryValue = (value: number, previous = false) => summaryMode === "average" ? value / (previous ? previousMonthDivisor : currentMonthDivisor) : value;
    const spendingTreemapValue = (value: number) => summaryMode === "average" ? value / currentMonthDivisor : value;
    const spendingTreemapUnit = summaryMode === "average" ? " kr / month" : " kr";
    const summarySuffix = summaryMode === "average" ? "Monthly average" : "Year to date";
    const waterfallSteps = [
        ...(incomeCategoryRows.length
            ? incomeCategoryRows.map((item) => ({ label: item.row.label, value: item.current, key: item.row.key, row: item.row }))
            : [{ label: "Income", value: currentIncome, key: "income", row: incomeRow }]),
        ...expenseCategoryRows
            .filter((item) => item.current > 0)
            .map((item) => ({ label: item.row.label, value: -item.current, key: item.row.key, row: item.row })),
        { label: "Operating surplus", value: 0, key: "diff", row: diffRow },
        { label: "Investment & pension", value: -currentInvestment, key: "investment", row: investmentRow },
        { label: "Cash after investing", value: 0, key: "cashflow", row: cashFlowRow },
    ];
    const waterfallText = waterfallSteps
        .map((step) => step.value === 0 && (step.key === "diff" || step.key === "cashflow")
            ? step.key === "diff" ? currentOperatingSurplus : currentNet
            : step.value)
        .map((value) => formatWholeNumber(value));
    const spendingSources = useMemo(
        () => buildSpendingSources(transactions, reportingCurrentPeriods, reportingPreviousPeriods, spendingCategory, spendingSubcategory),
        [reportingCurrentPeriods.join("|"), reportingPreviousPeriods.join("|"), spendingCategory, spendingSubcategory, transactions],
    );
    const spendingSourceRows = showAllSpendingSources ? spendingSources : spendingSources.slice(0, 12);
    const spendingCategories = [...new Set(buildSpendingSources(transactions, reportingCurrentPeriods, reportingPreviousPeriods, "").map((item) => item.category))].sort((left, right) => left.localeCompare(right, "da"));
    const spendingTreemapSources = useMemo(
        () => buildSpendingSources(transactions, reportingCurrentPeriods, reportingPreviousPeriods, spendingCategory),
        [reportingCurrentPeriods.join("|"), reportingPreviousPeriods.join("|"), spendingCategory, transactions],
    );
    const spendingTreemapCategories = [...new Set(spendingTreemapSources.map((item) => item.category))];
    const spendingTreemapCategoryTotals = new Map(spendingTreemapCategories.map((category) => [
        category,
        spendingTreemapSources.filter((item) => item.category === category).reduce((sum, item) => sum + item.spend, 0),
    ]));
    const spendingTreemapSubcategories = [...spendingTreemapSources.reduce((groups, source) => {
        const key = `${source.category}|${source.subcategory}`;
        const current = groups.get(key) ?? { key, label: source.subcategory, category: source.category, spend: 0, share: 0 };
        current.spend += source.spend;
        groups.set(key, current);
        return groups;
    }, new Map<string, SpendingSubcategory>()).values()];
    const spendingTreemapTotal = spendingTreemapSubcategories.reduce((sum, item) => sum + item.spend, 0);
    spendingTreemapSubcategories.forEach((item) => { item.share = spendingTreemapTotal ? (item.spend / spendingTreemapTotal) * 100 : 0; });
    const spendingPalette = ["#1687a7", "#09ab58", "#e09c38", "#9b70c9", "#e45b55", "#3c8a75", "#c97955", "#6f7fc4"];
    const spendingCategoryColor = new Map(spendingTreemapCategories.map((category, index) => [category, spendingPalette[index % spendingPalette.length]]));

    if (!selectedYear || reportingCurrentPeriods.length === 0) {
        return <section className="panel business-review"><p>No comparable yearly data is available yet.</p></section>;
    }

    return (
        <section className="business-review">
            <header className="business-review-header">
                <div>
                    <p className="eyebrow">Management review</p>
                    <h1>{selectedYear} year-to-date</h1>
                    <p>{holdUnpaidLiveMonth ? `${new Intl.DateTimeFormat("en", { month: "long" }).format(today)} is held out until income arrives; ` : ""}compared through the same completed months in {compareYear || "the prior period"}. Click any KPI, chart, or category to inspect transactions.</p>
                </div>
                <div className="business-review-controls">
                    <div className="business-summary-toggle" role="group" aria-label="Summary value mode">
                        <button type="button" className={summaryMode === "total" ? "active" : ""} onClick={() => setSummaryMode("total")}>Total</button>
                        <button type="button" className={summaryMode === "average" ? "active" : ""} onClick={() => setSummaryMode("average")}>Avg/month</button>
                    </div>
                    <label className="business-year-select">
                        <span>Reporting year</span>
                        <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
                            <option value="last_12">Last 12 full months</option>
                            {years.map((year) => <option key={year} value={year}>{year}</option>)}
                        </select>
                    </label>
                </div>
            </header>

            <div className="business-kpi-grid">
                <button type="button" className="business-kpi" onClick={() => incomeRow && onOpenDrilldown(incomeRow, `Income · ${selectedYear} YTD`, reportingCurrentPeriods)}>
                    <span>Income</span><strong>{formatBusinessValue(summaryValue(currentIncome))}</strong><small>{summarySuffix} · {formatBusinessDelta(businessDelta(currentIncome, previousIncome))}</small>
                </button>
                <button type="button" className="business-kpi" onClick={() => expenseRow && onOpenDrilldown(expenseRow, `Expenses · ${selectedYear} YTD`, reportingCurrentPeriods)}>
                    <span>Expenses</span><strong>{formatBusinessValue(summaryValue(currentExpense))}</strong><small>{summarySuffix} · {formatBusinessDelta(businessDelta(currentExpense, previousExpense))}</small>
                </button>
                <button type="button" className="business-kpi business-kpi-investment" onClick={() => investmentRow && onOpenDrilldown(investmentRow, `Investment & pension · ${selectedYear} YTD`, reportingCurrentPeriods)}>
                    <span>Investment &amp; pension</span><strong>{formatBusinessValue(summaryValue(currentInvestment))}</strong><small>{summarySuffix} · {formatBusinessDelta(businessDelta(currentInvestment, previousInvestment))}</small>
                </button>
                <button type="button" className="business-kpi" onClick={() => cashFlowRow && onOpenDrilldown(cashFlowRow, `Cash after investing · ${selectedYear} YTD`, reportingCurrentPeriods)}>
                    <span>Cash after investing</span><strong>{formatBusinessValue(summaryValue(currentNet))}</strong><small>{summarySuffix} · {formatBusinessDelta(businessDelta(currentNet, previousNet))}</small>
                </button>
                <div className="business-kpi">
                    <span>Savings rate</span><strong>{formatOneDecimal(savingsRate)}%</strong><small>{savingsRate - previousSavingsRate >= 0 ? "+" : ""}{formatOneDecimal(savingsRate - previousSavingsRate)} pp vs prior year</small>
                </div>
            </div>

            <div className="business-chart-grid">
                <section className="panel business-chart-panel business-chart-wide business-chart-clickable">
                    <div className="business-chart-heading"><div><h2>Monthly operating picture</h2><span>Income and gross spending · click any bar to inspect the month</span></div><button type="button" className="business-chart-drill-button" onClick={() => expenseRow && onOpenDrilldown(expenseRow, `Expenses · ${selectedYear} YTD`, reportingCurrentPeriods)}>View expenses</button></div>
                    <Plot
                        data={[
                            { type: "bar", name: `${selectedYear} income`, x: monthLabels, y: currentIncomeByMonth, marker: { color: "#09ab58", line: { width: 0 } }, customdata: currentPeriods, hovertemplate: "%{y:,.0f} kr<extra></extra>" },
                            { type: "bar", name: `${compareYear} income`, x: monthLabels, y: previousIncomeByMonth, marker: { color: "#a8ddc0", line: { width: 0 } }, customdata: previousPeriods, hovertemplate: "%{y:,.0f} kr<extra></extra>" },
                            { type: "bar", name: `${selectedYear} expenses`, x: monthLabels, y: currentExpenseByMonth, marker: { color: "#e45b55", line: { width: 0 } }, customdata: currentPeriods, hovertemplate: "%{y:,.0f} kr<extra></extra>" },
                            { type: "bar", name: `${compareYear} expenses`, x: monthLabels, y: previousExpenseByMonth, marker: { color: "#f2bbb7", line: { width: 0 } }, customdata: previousPeriods, hovertemplate: "%{y:,.0f} kr<extra></extra>" },
                        ] as never[]}
                        layout={{ ...sharedLayout, barmode: "group", bargap: 0.2, bargroupgap: 0.06, height: 390, xaxis: modernXAxis, yaxis: modernYAxis } as never}
                        config={{ displayModeBar: false, responsive: true }} useResizeHandler className="business-plot"
                        onClick={(event) => {
                            const point = event.points[0];
                            const period = String(point?.customdata ?? "");
                            const row = String(point?.data?.name ?? "").includes("income") ? incomeRow : expenseRow;
                            if (period && row) onOpenDrilldown(row, `${row.label} · ${period}`, [period]);
                        }}
                    />
                </section>

                <section className="panel business-chart-panel business-chart-clickable">
                    <div className="business-chart-heading"><div><h2>Investment &amp; pension</h2><span>Capital moved out of spending accounts · click to inspect</span></div><button type="button" className="business-chart-drill-button" onClick={() => investmentRow && onOpenDrilldown(investmentRow, `Investment & pension · ${selectedYear} YTD`, reportingCurrentPeriods)}>Drill down YTD</button></div>
                    <Plot
                        data={[
                            { type: "bar", name: selectedYear, x: monthLabels, y: currentInvestmentByMonth, marker: { color: "#ec6f9d" }, customdata: currentPeriods, hovertemplate: "%{y:,.0f} kr<extra></extra>" },
                            { type: "scatter", mode: "lines+markers", name: compareYear, x: monthLabels, y: previousInvestmentByMonth, line: { color: "#f3afc6", width: 2, dash: "dot" }, marker: { size: 6, color: "#f3afc6" }, customdata: previousPeriods, hovertemplate: "%{y:,.0f} kr<extra></extra>" },
                        ] as never[]}
                        layout={{ ...sharedLayout, height: 360, xaxis: modernXAxis, yaxis: modernYAxis } as never}
                        config={{ displayModeBar: false, responsive: true }} useResizeHandler className="business-plot"
                        onClick={(event) => {
                            const period = String(event.points[0]?.customdata ?? "");
                            if (period && investmentRow) onOpenDrilldown(investmentRow, `Investment & pension · ${period}`, [period]);
                        }}
                    />
                </section>

                <section className="panel business-chart-panel business-chart-clickable">
                    <div className="business-chart-heading"><div><h2>Cumulative net cash flow</h2><span>How the year builds month by month · click to inspect</span></div><button type="button" className="business-chart-drill-button" onClick={() => cashFlowRow && onOpenDrilldown(cashFlowRow, `Cash after investing · ${selectedYear === "last_12" ? "LTM" : selectedYear + " YTD"}`, reportingCurrentPeriods)}>Drill down YTD</button></div>
                    <Plot
                        data={[
                            { type: "scatter", mode: "lines+markers", name: selectedYear === "last_12" ? "Last 12 months" : selectedYear, x: fullYearMonthLabels, y: fullYearCurrentCumulative, line: { color: "#09ab58", width: 3, shape: "spline" }, marker: { size: 7, color: "#09ab58" }, fill: "tozeroy", fillcolor: "rgba(9,171,88,.08)", customdata: fullYearPeriods, hovertemplate: "%{y:,.0f} kr<extra></extra>" },
                            { type: "scatter", mode: "lines+markers", name: compareYear, x: fullYearMonthLabels, y: fullYearPreviousCumulative, line: { color: "#87958e", width: 2, dash: "dot", shape: "spline" }, marker: { size: 6 }, customdata: fullYearPreviousPeriods, hovertemplate: "%{y:,.0f} kr<extra></extra>" },
                        ] as never[]}
                        layout={{ ...sharedLayout, height: 360, xaxis: modernXAxis, yaxis: modernYAxis } as never}
                        config={{ displayModeBar: false, responsive: true }} useResizeHandler className="business-plot"
                        onClick={(event) => {
                            const period = String(event.points[0]?.customdata ?? "");
                            if (period && cashFlowRow) onOpenDrilldown(cashFlowRow, `Cash after investing · ${period}`, [period]);
                        }}
                    />
                </section>

                <section className="panel business-chart-panel business-chart-wide business-chart-clickable">
                    <div className="business-chart-heading"><div><h2>Cash-flow waterfall</h2><span>From income through each expense category to cash after investing · click any step to inspect</span></div><button type="button" className="business-chart-drill-button" onClick={() => cashFlowRow && onOpenDrilldown(cashFlowRow, `Cash-flow waterfall · ${selectedYear} YTD`, reportingCurrentPeriods)}>View cash flow</button></div>
                    <Plot
                        data={[{
                            type: "waterfall",
                            name: selectedYear,
                            x: waterfallSteps.map((step) => step.label),
                            y: waterfallSteps.map((step) => step.value),
                            measure: waterfallSteps.map((step) => step.key === "diff" || step.key === "cashflow" ? "total" : step.key === "income" ? "absolute" : "relative"),
                            customdata: waterfallSteps.map((step) => step.key),
                            text: waterfallText,
                            increasing: { marker: { color: "#09ab58" } },
                            decreasing: { marker: { color: "#e45b55" } },
                            totals: { marker: { color: currentNet >= 0 ? "#09ab58" : "#e45b55" } },
                            connector: { line: { color: "#718078", width: 1 } },
                            textposition: "outside",
                            texttemplate: "%{text}",
                            hovertemplate: "%{x} · %{text} kr<extra></extra>",
                        }] as never[]}
                        layout={{ ...sharedLayout, showlegend: false, height: 390, margin: { l: 68, r: 24, t: 30, b: 72 }, xaxis: modernXAxis, yaxis: modernYAxis } as never}
                        config={{ displayModeBar: false, responsive: true }} useResizeHandler className="business-plot business-waterfall"
                        onClick={(event) => {
                            const key = String(event.points[0]?.customdata ?? "");
                            const row = waterfallSteps.find((step) => step.key === key)?.row ?? null;
                            if (row) onOpenDrilldown(row, `${String(event.points[0]?.x ?? row.label)} · ${selectedYear} YTD`, reportingCurrentPeriods);
                        }}
                    />
                </section>

                <section className="panel business-chart-panel business-chart-clickable">
                    <div className="business-chart-heading"><div><h2>Expense mix <strong className="business-chart-basis">{summaryMode === "average" ? "Avg/month" : "Total"}</strong></h2><span>{summaryMode === "average" ? "Average spend per compared month" : "Largest categories year to date"} · click to drill down</span></div><button type="button" className="business-chart-drill-button" onClick={() => expenseRow && onOpenDrilldown(expenseRow, `Expense mix · ${selectedYear} YTD`, reportingCurrentPeriods)}>View all expenses</button></div>
                    <Plot
                        data={[
                            { type: "bar", orientation: "h", name: selectedYear, y: categoryRows.map((item) => item.row.label).reverse(), x: categoryRows.map((item) => summaryValue(item.current)).reverse(), marker: { color: "#09ab58" }, customdata: categoryRows.map((item) => item.row.key).reverse(), hovertemplate: `%{x:,.0f} kr${summaryMode === "average" ? " / month" : ""}<extra></extra>` },
                            { type: "bar", orientation: "h", name: compareYear, y: categoryRows.map((item) => item.row.label).reverse(), x: categoryRows.map((item) => summaryValue(item.previous, true)).reverse(), marker: { color: "#b8c7bf" }, customdata: categoryRows.map((item) => item.row.key).reverse(), hovertemplate: `%{x:,.0f} kr${summaryMode === "average" ? " / month" : ""}<extra></extra>` },
                        ] as never[]}
                        layout={{ ...sharedLayout, datarevision: summaryMode, barmode: "group", bargap: 0.22, height: 360, margin: { l: 145, r: 24, t: 32, b: 48 }, xaxis: { ...modernYAxis, title: summaryMode === "average" ? "DKK / month" : "DKK" }, yaxis: { showgrid: false, fixedrange: true } } as never}
                        config={{ displayModeBar: false, responsive: true }} useResizeHandler className="business-plot"
                        onClick={(event) => {
                            const key = String(event.points[0]?.customdata ?? "");
                            const row = section.rows.find((candidate) => candidate.key === key);
                            const isPrior = String(event.points[0]?.data?.name ?? "") === compareYear;
                            const periods = isPrior ? reportingPreviousPeriods : reportingCurrentPeriods;
                            const year = isPrior ? compareYear : selectedYear;
                            if (row) onOpenDrilldown(row, `${row.label} · ${year} YTD`, periods);
                        }}
                    />
                </section>
            </div>

            <section className={`panel spending-source-panel${spendingTreemapFullscreen ? " fullscreen" : ""}`}>
                <div className="business-chart-heading spending-source-heading">
                    <div>
                        <h2>Where the money goes</h2>
                        <span>Payees and spending patterns between categories and individual transactions</span>
                    </div>
                    <div className="spending-source-actions">
                        <label className="spending-source-filter">
                            <span>Category</span>
                            <select value={spendingCategory} onChange={(event) => { setSpendingCategory(event.target.value); setSpendingSubcategory(""); setShowAllSpendingSources(false); }}>
                                <option value="">All spending</option>
                                {spendingCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                        </label>
                        <button
                            type="button"
                            className="spending-source-fullscreen"
                            aria-pressed={spendingTreemapFullscreen}
                            onClick={() => setSpendingTreemapFullscreen((current) => !current)}
                        >
                            <span aria-hidden="true">{spendingTreemapFullscreen ? "↙" : "↗"}</span>
                            {spendingTreemapFullscreen ? "Exit fullscreen" : "Fullscreen"}
                        </button>
                    </div>
                </div>
                {spendingSubcategory ? (
                    <div className="spending-source-context">
                        <span>Showing sources in <strong>{spendingSubcategory}</strong>{spendingCategory ? ` · ${spendingCategory}` : ""}</span>
                        <button type="button" onClick={() => setSpendingSubcategory("")}>Clear subcategory</button>
                    </div>
                ) : null}
                {spendingSourceRows.length > 0 ? (
                    <div className="spending-source-layout">
                        <Plot
                            key={`spending-treemap-${spendingTreemapFullscreen ? "fullscreen" : "inline"}-${spendingCategory}`}
                            data={[{
                                type: "treemap",
                                ids: [
                                    ...spendingTreemapCategories.map((category) => `category:${category}`),
                                    ...spendingTreemapSubcategories.map((item) => `subcategory:${item.key}`),
                                ],
                                labels: [
                                    ...spendingTreemapCategories,
                                    ...spendingTreemapSubcategories.map((item) => item.label),
                                ],
                                parents: [
                                    ...spendingTreemapCategories.map(() => ""),
                                    ...spendingTreemapSubcategories.map((item) => `category:${item.category}`),
                                ],
                                values: [
                                    ...spendingTreemapCategories.map((category) => spendingTreemapValue(spendingTreemapCategoryTotals.get(category) ?? 0)),
                                    ...spendingTreemapSubcategories.map((item) => spendingTreemapValue(item.spend)),
                                ],
                                customdata: [
                                    ...spendingTreemapCategories.map(() => ""),
                                    ...spendingTreemapSubcategories.map((item) => item.label),
                                ],
                                branchvalues: "total",
                                marker: {
                                    colors: [
                                        ...spendingTreemapCategories.map((category) => spendingCategoryColor.get(category)),
                                        ...spendingTreemapSubcategories.map((item) => spendingCategoryColor.get(item.category)),
                                    ],
                                    line: { color: "rgba(255,255,255,.28)", width: 1 },
                                },
                                textinfo: "none",
                                texttemplate: [
                                    ...spendingTreemapCategories.map(() => "<b>%{label}</b><br>%{percentRoot:.0%}"),
                                    ...spendingTreemapSubcategories.map((item) => item.share >= (spendingTreemapFullscreen ? 0.12 : 0.6) ? "<b>%{label}</b><br>%{percentRoot:.1%}" : ""),
                                ],
                                textfont: { color: "#f7fffa", size: spendingTreemapFullscreen ? 11 : 11 },
                                hovertemplate: `<b>%{label}</b><br>%{value:,.0f}${spendingTreemapUnit} · %{percentRoot:.1%} of spending<extra></extra>`,
                                pathbar: { visible: false },
                            }] as never[]}
                            layout={{ ...sharedLayout, datarevision: summaryMode, margin: { l: 4, r: 4, t: 8, b: 4 }, height: spendingTreemapFullscreen ? Math.max(600, window.innerHeight - 165) : 430, showlegend: false, uniformtext: { minsize: 8, mode: "hide" } } as never}
                            config={{ displayModeBar: false, responsive: true }}
                            useResizeHandler
                            className="business-plot spending-source-treemap"
                            onClick={(event) => {
                                const point = event.points[0] as unknown as { id?: unknown; customdata?: unknown; label?: unknown } | undefined;
                                const id = String(point?.id ?? "");
                                if (id.startsWith("category:")) {
                                    setSpendingTreemapFullscreen(false);
                                    setSpendingCategory(id.slice("category:".length));
                                    setSpendingSubcategory("");
                                    setShowAllSpendingSources(false);
                                    return;
                                }
                                setSpendingTreemapFullscreen(false);
                                if (id.startsWith("subcategory:")) {
                                    const [category, subcategory] = id.slice("subcategory:".length).split("|");
                                    setSpendingCategory(category);
                                    setSpendingSubcategory(subcategory);
                                    setShowAllSpendingSources(false);
                                }
                            }}
                        />
                        <div className={`spending-source-list${showAllSpendingSources ? " expanded" : ""}`} role="list" aria-label="Top spending sources">
                            <div className="spending-source-list-head">
                                <span>Source</span><span>{summaryMode === "average" ? "Avg/month" : "Spend"}</span>
                            </div>
                            {spendingSources.length > 12 ? (
                                <button type="button" className="spending-source-more" onClick={() => setShowAllSpendingSources((current) => !current)}>
                                    {showAllSpendingSources ? "Show top 12" : `Show all ${spendingSources.length} sources`}
                                </button>
                            ) : null}
                            {spendingSourceRows.map((item) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    className="spending-source-row"
                                    onClick={() => onOpenSpendingSource(`${item.label} · ${selectedYear} YTD`, item.searchText, reportingCurrentPeriods)}
                                >
                                    <span className="spending-source-copy">
                                        <strong>{item.label}</strong>
                                        <small>{item.subcategory} · {item.count} {item.count === 1 ? "payment" : "payments"} across {item.monthCount} {item.monthCount === 1 ? "month" : "months"} · avg {formatBusinessValue(item.average)}</small>
                                        <span className="spending-source-track"><span style={{ width: `${Math.max(3, item.share)}%`, background: spendingCategoryColor.get(item.category) }} /></span>
                                    </span>
                                    <span className="spending-source-value">
                                        <strong>{formatBusinessValue(summaryValue(item.spend))}</strong>
                                        <small className={item.change !== null && item.change > 0 ? "spiir-negative" : "spiir-positive"}>{item.cadence} · {formatBusinessDelta(item.change)}</small>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : <p className="spending-source-empty">No spending sources are available for this period.</p>}
            </section>

            {spendingTreemapTotal > 0 ? (
                <section className="panel business-chart-panel spending-sunburst-panel business-chart-clickable">
                    <div className="business-chart-heading">
                        <div>
                            <h2>Expense category sunburst</h2>
                            <span>Main categories on the inner ring and subcategories on the outer ring · click a segment to filter the spending view above</span>
                        </div>
                    </div>
                    <Plot
                        data={[{
                            type: "sunburst",
                            ids: [
                                "expense-root",
                                ...spendingTreemapCategories.map((category) => `category:${category}`),
                                ...spendingTreemapSubcategories.map((item) => `subcategory:${item.key}`),
                            ],
                            labels: [
                                "Expenses",
                                ...spendingTreemapCategories,
                                ...spendingTreemapSubcategories.map((item) => item.label),
                            ],
                            parents: [
                                "",
                                ...spendingTreemapCategories.map(() => "expense-root"),
                                ...spendingTreemapSubcategories.map((item) => `category:${item.category}`),
                            ],
                            values: [
                                spendingTreemapTotal,
                                ...spendingTreemapCategories.map((category) => spendingTreemapCategoryTotals.get(category) ?? 0),
                                ...spendingTreemapSubcategories.map((item) => item.spend),
                            ],
                            branchvalues: "total",
                            marker: {
                                colors: [
                                    "#607069",
                                    ...spendingTreemapCategories.map((category) => spendingCategoryColor.get(category)),
                                    ...spendingTreemapSubcategories.map((item) => spendingCategoryColor.get(item.category)),
                                ],
                                line: { color: "rgba(255,255,255,.4)", width: 1 },
                            },
                            textinfo: "label+percent root",
                            insidetextorientation: "radial",
                            hovertemplate: "<b>%{label}</b><br>%{value:,.0f} kr · %{percentRoot:.1%} of spending<extra></extra>",
                        }] as never[]}
                        layout={{
                            ...sharedLayout,
                            margin: { l: 12, r: 12, t: 12, b: 12 },
                            height: 520,
                            showlegend: false,
                            uniformtext: { minsize: 9, mode: "hide" },
                        } as never}
                        config={{ displayModeBar: false, responsive: true }}
                        useResizeHandler
                        className="business-plot spending-sunburst-plot"
                        onClick={(event) => {
                            const point = event.points[0] as unknown as { id?: unknown } | undefined;
                            const id = String(point?.id ?? "");
                            if (id.startsWith("category:")) {
                                setSpendingCategory(id.slice("category:".length));
                                setSpendingSubcategory("");
                                setShowAllSpendingSources(false);
                                return;
                            }
                            if (id.startsWith("subcategory:")) {
                                const [category, subcategory] = id.slice("subcategory:".length).split("|");
                                setSpendingCategory(category);
                                setSpendingSubcategory(subcategory);
                                setShowAllSpendingSources(false);
                            }
                        }}
                    />
                </section>
            ) : null}

            <section className="panel business-driver-table">
                <div className="business-chart-heading"><h2>Cost drivers</h2><span>{summaryMode === "average" ? "Average per compared month" : "Current YTD versus comparable prior period"}</span></div>
                <table>
                    <thead><tr><th>Category</th><th>{selectedYear}</th><th>{compareYear}</th><th>Change</th></tr></thead>
                    <tbody>{categoryRows.map((item) => (
                        <tr key={item.row.key} onClick={() => onOpenDrilldown(item.row, `${item.row.label} · ${selectedYear} YTD`, reportingCurrentPeriods)}>
                            <td>{item.row.label}</td><td>{formatBusinessValue(summaryValue(item.current))}</td><td>{formatBusinessValue(summaryValue(item.previous, true))}</td><td className={item.current <= item.previous ? "spiir-positive" : "spiir-negative"}>{formatBusinessDelta(businessDelta(item.current, item.previous))}</td>
                        </tr>
                    ))}</tbody>
                </table>
            </section>
        </section>
    );
}

export default function SpiirDashboard({ active }: { active: boolean }) {
    const [status, setStatus] = useState<SpiirStatusResponse | null>(() => getCachedSpiirData().status);
    const [overview, setOverview] = useState<SpiirOverviewResponse | null>(() => getCachedSpiirData().overview);
    const [transactions, setTransactions] = useState<SpiirTransaction[] | null>(() => getCachedSpiirData().transactions);
    const backgroundRefreshIdRef = useRef(0);
    const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<SpiirTab>("business");
    const [expandedMonthlyRows, setExpandedMonthlyRows] = useState<Set<string>>(new Set(["income", "expense", "investment", "hashtag"]));
    const [expandedYearlyRows, setExpandedYearlyRows] = useState<Set<string>>(new Set(["income", "expense", "investment", "hashtag"]));
    const [ledgerDrilldownModal, setLedgerDrilldownModal] = useState<LedgerDrilldownModalState>(null);
    const [sunburstState, setSunburstState] = useState<SunburstState>(null);
    const [monthWindow, setMonthWindow] = useState(() => readStoredString("spiir_monthCount", "12"));
    const [yearWindow, setYearWindow] = useState(() => readStoredString("spiir_yearCount", "all"));
    const [excludeLatestMonth, setExcludeLatestMonth] = useState(() => readStoredBool("spiir_excludeMonth", true));
    const [excludeLatestYear, setExcludeLatestYear] = useState(() => readStoredBool("spiir_excludeYear", false));
    const [heatmap, setHeatmap] = useState(() => readStoredBool("spiir_heatmap", false));
    const [showPrevTotals, setShowPrevTotals] = useState(() => readStoredBool("spiir_prevAvgDelta", false));
    const [monthlyChart, setMonthlyChart] = useState<ChartOptions>({
        show: readStoredBool("chart.monthly.show", true),
        cumulative: readStoredBool("chart.monthly.cum", false),
        stacked: readStoredBool("chart.monthly.stack", false),
        bars: readStoredBool("chart.monthly.bars", false),
        level: readStoredString("chart.monthly.level", "top") as ChartLevel
    });
    const [yearlyChart, setYearlyChart] = useState<ChartOptions>({
        show: readStoredBool("chart.yearly.show", true),
        cumulative: readStoredBool("chart.yearly.cum", false),
        stacked: readStoredBool("chart.yearly.stack", false),
        bars: readStoredBool("chart.yearly.bars", false),
        level: readStoredString("chart.yearly.level", "top") as ChartLevel
    });
    const [hiddenMonthlySeries, setHiddenMonthlySeries] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!active) {
            setToolbarHost(null);
            return;
        }
        if (typeof document !== "undefined") {
            setToolbarHost(document.getElementById("spiir-header-controls"));
        }
        void loadSpiir();
    }, [active]);

    useEffect(() => {
        if (active && tab === "business" && status?.processed_exists && transactions === null) {
            void ensureTransactionsLoaded();
        }
    }, [active, status?.processed_exists, tab, transactions]);

    useEffect(() => { storeString("spiir_monthCount", monthWindow); }, [monthWindow]);
    useEffect(() => { storeString("spiir_yearCount", yearWindow); }, [yearWindow]);
    useEffect(() => { storeBool("spiir_excludeMonth", excludeLatestMonth); }, [excludeLatestMonth]);
    useEffect(() => { storeBool("spiir_excludeYear", excludeLatestYear); }, [excludeLatestYear]);
    useEffect(() => { storeBool("spiir_heatmap", heatmap); }, [heatmap]);
    useEffect(() => { storeBool("spiir_prevAvgDelta", showPrevTotals); }, [showPrevTotals]);
    useEffect(() => {
        storeBool("chart.monthly.show", monthlyChart.show);
        storeBool("chart.monthly.cum", monthlyChart.cumulative);
        storeBool("chart.monthly.stack", monthlyChart.stacked);
        storeBool("chart.monthly.bars", monthlyChart.bars);
        storeString("chart.monthly.level", monthlyChart.level);
    }, [monthlyChart]);
    useEffect(() => {
        storeBool("chart.yearly.show", yearlyChart.show);
        storeBool("chart.yearly.cum", yearlyChart.cumulative);
        storeBool("chart.yearly.stack", yearlyChart.stacked);
        storeBool("chart.yearly.bars", yearlyChart.bars);
        storeString("chart.yearly.level", yearlyChart.level);
    }, [yearlyChart]);

    useEffect(() => {
        if (!ledgerDrilldownModal && !sunburstState) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") {
                return;
            }
            event.preventDefault();
            if (ledgerDrilldownModal) {
                setLedgerDrilldownModal(null);
                return;
            }
            closeSunburst();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [ledgerDrilldownModal, sunburstState]);

    function scheduleBackgroundSpiirRefresh(attempt = 1): void {
        const refreshId = backgroundRefreshIdRef.current + 1;
        backgroundRefreshIdRef.current = refreshId;
        window.setTimeout(() => {
            if (backgroundRefreshIdRef.current !== refreshId) {
                return;
            }
            void getSpiirStatus()
                .then(async (nextStatus) => {
                    if (backgroundRefreshIdRef.current !== refreshId) {
                        return;
                    }
                    setStatus(nextStatus);
                    if (nextStatus.rebuild_required && attempt < 5) {
                        scheduleBackgroundSpiirRefresh(attempt + 1);
                        return;
                    }
                    if (nextStatus.processed_exists) {
                        setOverview(await getSpiirOverview());
                        setTransactions(null);
                    }
                })
                .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Kunne ikke hente Spiir-data"));
        }, 4000);
    }

    async function loadSpiir(): Promise<void> {
        setError(null);
        try {
            const nextStatus = await getSpiirStatus();
            setStatus(nextStatus);
            if (nextStatus.rebuild_required) {
                void scheduleSpiirRebuildFromLocal(0)
                    .then(() => scheduleBackgroundSpiirRefresh())
                    .catch(() => undefined);
            }
            if (nextStatus.processed_exists) {
                setOverview(await getSpiirOverview());
            } else {
                setOverview(null);
                setTransactions(null);
            }
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Kunne ikke hente Spiir-data");
        }
    }

    async function handleRebuildFromLocal(): Promise<void> {
        setBusy(true);
        setError(null);
        try {
            await rebuildSpiirFromLocal();
            setTransactions(null);
            await loadSpiir();
        } catch (updateError) {
            setError(updateError instanceof Error ? updateError.message : "Kunne ikke bygge Spiir fra ledger");
        } finally {
            setBusy(false);
        }
    }

    async function ensureTransactionsLoaded(): Promise<SpiirTransaction[]> {
        if (transactions !== null) {
            return transactions;
        }
        if (!status?.processed_exists) {
            const missingError = new Error("Spiir er ikke bygget endnu. Klik Byg fra ledger først.");
            setError(missingError.message);
            throw missingError;
        }
        setBusy(true);
        setError(null);
        try {
            const loaded = await getSpiirTransactions();
            setTransactions(loaded);
            return loaded;
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Kunne ikke hente transaktioner");
            throw loadError;
        } finally {
            setBusy(false);
        }
    }

    async function handleOpenDrilldown(row: SpiirOverviewRow, title: string, periods: string[], kind: PeriodKind): Promise<void> {
        const drilldownFilter = drilldownFilterFromOverviewRow(row, periods, kind);
        setLedgerDrilldownModal({
            ...drilldownFilter,
            title,
        });
    }

    function handleOpenSpendingSource(title: string, searchText: string, periods: string[]): void {
        setLedgerDrilldownModal({
            title,
            ...periodFilterForDrilldown(periods, "month"),
            visibilityFilter: "expense",
            categoryFilter: null,
            outflowsOnly: true,
            searchText,
        });
    }

    async function handleOpenSunburst(title: string, periods: string[], mode: SunburstMode, rows: SpiirOverviewRow[]): Promise<void> {
        setSunburstState({ title, periods, mode, rows });
    }

    function closeSunburst(): void {
        setSunburstState(null);
    }

    function openLedgerDrilldownFromTransactions(title: string, items: SpiirTransaction[]): void {
        const categoryFilter = categoryOptionFromTransactions(items);
        setLedgerDrilldownModal({
            title,
            periodFilter: periodFilterFromTransactions(items),
            visibilityFilter: categoryFilter ? "category" : "all",
            categoryFilter,
            searchText: items.length === 1 ? String(items[0].description ?? "") : "",
        });
    }

    const monthly = overview?.monthly;
    const yearly = overview?.yearly;
    const monthlyVisiblePeriods = useMemo(() => visibleMonthPeriods(monthly?.periods ?? [], monthWindow, excludeLatestMonth), [excludeLatestMonth, monthWindow, monthly?.periods]);
    const yearlyVisiblePeriods = useMemo(() => visibleYearPeriods(yearly?.periods ?? [], yearWindow, excludeLatestYear), [excludeLatestYear, yearWindow, yearly?.periods]);
    const monthlyPrevPeriods = useMemo(() => previousWindow(monthly?.periods ?? [], monthlyVisiblePeriods), [monthly?.periods, monthlyVisiblePeriods]);
    const yearlyPrevPeriods = useMemo(() => previousWindow(yearly?.periods ?? [], yearlyVisiblePeriods), [yearly?.periods, yearlyVisiblePeriods]);
    const yearlyProjection = useMemo(() => {
        if (!monthly || !yearly || yearly.periods.length === 0) {
            return null;
        }
        const year = yearly.periods[yearly.periods.length - 1];
        const yearMonths = monthly.periods.filter((period) => period.startsWith(`${year}-`));
        
        // If the year is fully complete (12 months), no need for a projection
        if (yearMonths.length >= 12) {
            return null;
        }
        
        // Use all available months in that year for the projection basis
        return yearMonths.length > 0 ? { year, periods: yearMonths, monthlyRows: monthly.rows } : null;
    }, [monthly, yearly]);
    const monthlyChartFigure = useMemo(
        () => monthly && monthlyVisiblePeriods.length > 0 ? buildPeriodChartFigure(monthly, monthlyVisiblePeriods, "month", { ...monthlyChart, bars: true, cumulative: false, stacked: false, level: "top" }, hiddenMonthlySeries) : null,
        [hiddenMonthlySeries, monthly, monthlyChart, monthlyVisiblePeriods]
    );
    const yearlyChartFigure = useMemo(
        () => yearly && yearlyVisiblePeriods.length > 0 ? buildPeriodChartFigure(yearly, yearlyVisiblePeriods, "year", yearlyChart) : null,
        [yearly, yearlyChart, yearlyVisiblePeriods]
    );
    const monthYearOptions = useMemo(() => {
        const years = [...new Set((monthly?.periods ?? []).map((period) => period.slice(0, 4)))].sort();
        return [...MONTH_WINDOW_OPTIONS, ...years.map((year) => ({ value: `y:${year}`, label: year }))];
    }, [monthly?.periods]);
    const currentChart = tab === "monthly" ? monthlyChart : yearlyChart;
    const setCurrentChart = tab === "monthly" ? setMonthlyChart : setYearlyChart;
    const currentChartFigure = tab === "monthly" ? monthlyChartFigure : yearlyChartFigure;
    const currentWindow = tab === "monthly" ? monthWindow : yearWindow;
    const setCurrentWindow = tab === "monthly" ? setMonthWindow : setYearWindow;
    const currentWindowOptions = tab === "monthly" ? monthYearOptions : YEAR_WINDOW_OPTIONS;
    const currentExcludeLatest = tab === "monthly" ? excludeLatestMonth : excludeLatestYear;
    const setCurrentExcludeLatest = tab === "monthly" ? setExcludeLatestMonth : setExcludeLatestYear;
    const toolbar = active && toolbarHost ? createPortal(
        <div className="spiir-header-tools">
            <div className="scope-switcher" aria-label="Vælg Spiir-visning">
                <button type="button" className={tab === "business" ? "nav-pill active" : "nav-pill"} onClick={() => setTab("business")}>Business review</button>
                <button type="button" className={tab === "monthly" ? "nav-pill active" : "nav-pill"} onClick={() => setTab("monthly")}>
                    Måned
                </button>
                <button type="button" className={tab === "yearly" ? "nav-pill active" : "nav-pill"} onClick={() => setTab("yearly")}>
                    År
                </button>
            </div>
            {tab !== "business" ? <label className="spiir-header-control spiir-window-control">
                <select className="spiir-window-select" value={currentWindow} onChange={(event) => setCurrentWindow(event.target.value)}>
                    {currentWindowOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </label> : null}
            {tab !== "business" ? <div className="scope-switcher spiir-toggle-group" aria-label="Spiir toggles">
                <TogglePill label="Skip sidste" active={currentExcludeLatest} onClick={() => setCurrentExcludeLatest(!currentExcludeLatest)} />
                <TogglePill label="Heatmap" active={heatmap} onClick={() => setHeatmap(!heatmap)} />
                <TogglePill label="Prev" active={showPrevTotals} onClick={() => setShowPrevTotals(!showPrevTotals)} />
                <TogglePill label="Chart" active={currentChart.show} onClick={() => setCurrentChart((current) => ({ ...current, show: !current.show }))} />
            </div> : null}
        </div>,
        toolbarHost
    ) : null;

    return (
        <section className="spiir-shell">
            {toolbar}
            {error ? <p className="error-banner">{error}</p> : null}
            {status?.rebuild_required ? (
                <div className="info-banner banner-with-action">
                    <span>
                        Spiir-overblikket er forældet. Byg fra ledger for at opdatere det.
                    </span>
                    <button type="button" className="secondary-button" onClick={() => void handleRebuildFromLocal()} disabled={busy}>
                        {busy ? "Bygger..." : "Byg fra ledger"}
                    </button>
                </div>
            ) : null}
            {!status?.processed_exists ? (
                <div className="info-banner banner-with-action">
                    <span>Der er ingen bygget Spiir-oversigt endnu. Byg fra ledger for at åbne oversigten.</span>
                    <button type="button" className="secondary-button" onClick={() => void handleRebuildFromLocal()} disabled={busy}>
                        {busy ? "Bygger..." : "Byg fra ledger"}
                    </button>
                </div>
            ) : null}

            {tab !== "business" && currentChart.show && currentChartFigure ? (
                <section className="panel spiir-panel spiir-plot-panel">
                    <div className="spiir-plot-surface">
                        <div className="panel-header compact-header spiir-plot-header">
                            <div>
                                <h2>{tab === "monthly" ? "Månedschart" : "Årchart"}</h2>
                                <span>{tab === "monthly" ? "Income and expenses share one axis; result overlays them" : "Yearly development and category composition"}</span>
                            </div>
                            {tab === "monthly" ? <div className="spiir-series-legend" aria-label="Vis eller skjul serier">
                                {[
                                    ["income", "Income"],
                                    ["expense", "Expenses"],
                                    ["diff", "Result"],
                                ].map(([key, label]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        className={`spiir-series-legend-item spiir-series-${key}`}
                                        aria-pressed={!hiddenMonthlySeries.has(key)}
                                        onClick={() => setHiddenMonthlySeries((current) => {
                                            const next = new Set(current);
                                            if (next.has(key)) next.delete(key); else next.add(key);
                                            return next;
                                        })}
                                    >
                                        <span aria-hidden="true" />{label}
                                    </button>
                                ))}
                            </div> : <div className="spiir-control-bar spiir-control-bar-chart">
                                <TogglePill label="Cumulative" active={currentChart.cumulative} onClick={() => setCurrentChart((current) => ({ ...current, cumulative: !current.cumulative }))} />
                                <TogglePill label="Stack" active={currentChart.stacked} onClick={() => setCurrentChart((current) => ({ ...current, stacked: !current.stacked }))} />
                                <TogglePill label="Bars" active={currentChart.bars} onClick={() => setCurrentChart((current) => ({ ...current, bars: !current.bars }))} />
                                <label className="spiir-sort-select-wrap spiir-inline-control">
                                    <span>Level</span>
                                    <select
                                        value={currentChart.level}
                                        onChange={(event) => setCurrentChart((current) => ({ ...current, level: event.target.value as ChartLevel }))}
                                    >
                                        <option value="top">Top</option>
                                        <option value="main">Main</option>
                                        <option value="sub">Sub</option>
                                    </select>
                                </label>
                            </div>}
                        </div>
                        <Plot
                            data={currentChartFigure.data as never[]}
                            layout={currentChartFigure.layout as never}
                            config={{ displayModeBar: false, responsive: true }}
                            useResizeHandler
                            className="spiir-plot"
                        />
                    </div>
                </section>
            ) : null}

            {tab === "business" && monthly ? (
                <BusinessReview
                    section={monthly}
                    transactions={transactions}
                    onOpenDrilldown={(row, title, periods) => void handleOpenDrilldown(row, title, periods, "month")}
                    onOpenSpendingSource={handleOpenSpendingSource}
                />
            ) : null}

            {tab === "monthly" && monthly ? (
                <OverviewSection
                    title="Månedsoversigt"
                    section={monthly}
                    periodKind="month"
                    visiblePeriods={monthlyVisiblePeriods}
                    prevPeriods={monthlyPrevPeriods}
                    expandedRows={expandedMonthlyRows}
                    heatmap={heatmap}
                    showPrevTotals={showPrevTotals}
                    projection={null}
                    onExpandAll={() => setExpandedMonthlyRows(new Set(monthly.rows.map((row) => row.key)))}
                    onCollapseAll={() => setExpandedMonthlyRows(new Set())}
                    onOpenDrilldown={(row, title, periods, kind) => void handleOpenDrilldown(row, title, periods, kind)}
                    onOpenSunburst={(title, periods, mode, rows) => void handleOpenSunburst(title, periods, mode, rows)}
                    onToggle={(key) => setExpandedMonthlyRows((current) => {
                        const next = new Set(current);
                        if (next.has(key)) {
                            next.delete(key);
                        } else {
                            next.add(key);
                        }
                        return next;
                    })}
                />
            ) : null}

            {tab === "yearly" && yearly ? (
                <OverviewSection
                    title="Årsoversigt"
                    section={yearly}
                    periodKind="year"
                    visiblePeriods={yearlyVisiblePeriods}
                    prevPeriods={yearlyPrevPeriods}
                    expandedRows={expandedYearlyRows}
                    heatmap={heatmap}
                    showPrevTotals={showPrevTotals}
                    projection={yearlyProjection}
                    onExpandAll={() => setExpandedYearlyRows(new Set(yearly.rows.map((row) => row.key)))}
                    onCollapseAll={() => setExpandedYearlyRows(new Set())}
                    onOpenDrilldown={(row, title, periods, kind) => void handleOpenDrilldown(row, title, periods, kind)}
                    onOpenSunburst={(title, periods, mode, rows) => void handleOpenSunburst(title, periods, mode, rows)}
                    onToggle={(key) => setExpandedYearlyRows((current) => {
                        const next = new Set(current);
                        if (next.has(key)) {
                            next.delete(key);
                        } else {
                            next.add(key);
                        }
                        return next;
                    })}
                />
            ) : null}

            {sunburstState ? (
                <SpiirSunburstModal
                    state={sunburstState}
                    transactions={transactions}
                    closeOnEscape={!ledgerDrilldownModal}
                    ensureTransactionsLoaded={ensureTransactionsLoaded}
                    onClose={closeSunburst}
                    onOpenTransactions={openLedgerDrilldownFromTransactions}
                />
            ) : null}
            {ledgerDrilldownModal ? (
                <div className="modal-backdrop" onClick={() => setLedgerDrilldownModal(null)}>
                    <section className="ledger-drilldown-modal" onClick={(event) => event.stopPropagation()}>
                        <LedgerDashboard
                            key={`${ledgerDrilldownModal.title}|${ledgerDrilldownModal.periodFilter ?? "all"}|${ledgerDrilldownModal.categoryFilter?.categoryId ?? ""}|${ledgerDrilldownModal.searchText ?? ""}`}
                            active
                            embedded
                            initialFilter={ledgerDrilldownModal}
                            onClose={() => setLedgerDrilldownModal(null)}
                        />
                    </section>
                </div>
            ) : null}
        </section>
    );
}

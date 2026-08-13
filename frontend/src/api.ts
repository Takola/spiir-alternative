import { mergeUpdatedTransactions } from "./ledgerState";
import type {
    LedgerOverridePatch,
    LedgerOverrideResponse,
    LedgerRetrieveJobStatus,
    LedgerTaxonomyResponse,
    LedgerTransactionsResponse,
    SpiirIncomeExpenseSeriesResponse,
    SpiirOverviewResponse,
    SpiirStatusResponse,
    SpiirTransaction
} from "./types";

type CacheSlot<T> = {
    value: T | null;
    promise: Promise<T> | null;
};

const spiirCache = {
    status: { value: null, promise: null } as CacheSlot<SpiirStatusResponse>,
    overview: { value: null, promise: null } as CacheSlot<SpiirOverviewResponse>,
    incomeExpenseSeries: { value: null, promise: null } as CacheSlot<SpiirIncomeExpenseSeriesResponse>,
    transactions: { value: null, promise: null } as CacheSlot<SpiirTransaction[]>
};

const localLedgerCache = {
    full: { value: null, promise: null } as CacheSlot<LedgerTransactionsResponse>,
    pages: new Map<string, CacheSlot<LedgerTransactionsResponse>>()
};

function cachedRequest<T>(slot: CacheSlot<T>, loader: () => Promise<T>): Promise<T> {
    if (slot.value !== null) {
        return Promise.resolve(slot.value);
    }
    if (slot.promise !== null) {
        return slot.promise;
    }
    slot.promise = loader()
        .then((value) => {
            slot.value = value;
            return value;
        })
        .finally(() => {
            slot.promise = null;
        });
    return slot.promise;
}

export function getCachedSpiirData(): {
    status: SpiirStatusResponse | null;
    overview: SpiirOverviewResponse | null;
    transactions: SpiirTransaction[] | null;
} {
    return {
        status: spiirCache.status.value,
        overview: spiirCache.overview.value,
        transactions: spiirCache.transactions.value
    };
}

export function invalidateSpiirCache(): void {
    spiirCache.status.value = null;
    spiirCache.status.promise = null;
    spiirCache.overview.value = null;
    spiirCache.overview.promise = null;
    spiirCache.incomeExpenseSeries.value = null;
    spiirCache.incomeExpenseSeries.promise = null;
    spiirCache.transactions.value = null;
    spiirCache.transactions.promise = null;
}

export function invalidateLocalLedgerCache(): void {
    localLedgerCache.full.value = null;
    localLedgerCache.full.promise = null;
    localLedgerCache.pages.clear();
}

function localLedgerPageKey(options?: { limit?: number; offset?: number }): string {
    return `${options?.offset ?? 0}:${options?.limit ?? "all"}`;
}

function localLedgerPageSlot(options?: { limit?: number; offset?: number }): CacheSlot<LedgerTransactionsResponse> {
    const key = localLedgerPageKey(options);
    const existing = localLedgerCache.pages.get(key);
    if (existing) {
        return existing;
    }
    const slot = { value: null, promise: null } as CacheSlot<LedgerTransactionsResponse>;
    localLedgerCache.pages.set(key, slot);
    return slot;
}

function sliceLocalLedgerResponse(payload: LedgerTransactionsResponse, options?: { limit?: number; offset?: number }): LedgerTransactionsResponse {
    const offset = Math.max(options?.offset ?? 0, 0);
    const limit = options?.limit ?? null;
    const transactions = limit === null
        ? payload.transactions.slice(offset)
        : payload.transactions.slice(offset, offset + Math.max(limit, 0));
    return {
        ...payload,
        transactions,
        loaded_count: transactions.length,
        offset,
        limit,
        has_more: offset + transactions.length < payload.transactions.length,
    };
}

function patchLocalLedgerCache(result: LedgerOverrideResponse): void {
    localLedgerCache.full.value = mergeUpdatedTransactions(
        localLedgerCache.full.value,
        result.updated_transactions,
        result.deleted_transaction_ids,
    );
    for (const slot of localLedgerCache.pages.values()) {
        slot.value = mergeUpdatedTransactions(slot.value, result.updated_transactions, result.deleted_transaction_ids);
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        credentials: "include",
        ...init
    });

    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            const payload = (await response.json()) as { detail?: string };
            if (payload.detail) {
                message = payload.detail;
            }
        } else {
            const text = await response.text();
            if (text) {
                const compactText = text.replace(/\s+/g, " ").trim();
                const looksLikeHtml = /<html|<body|<title|<!doctype/i.test(compactText);
                if (looksLikeHtml) {
                    message = response.status === 504
                        ? "Gateway timeout (504)."
                        : `HTTP ${response.status}`;
                } else {
                    message = compactText;
                }
            }
        }
        throw new Error(message);
    }

    return (await response.json()) as T;
}

export async function getSpiirStatus(): Promise<SpiirStatusResponse> {
    return cachedRequest(spiirCache.status, () => request<SpiirStatusResponse>("/api/spiir/status"));
}

export async function getSpiirOverview(): Promise<SpiirOverviewResponse> {
    return cachedRequest(spiirCache.overview, () => request<SpiirOverviewResponse>("/api/spiir/overview"));
}

export async function getSpiirTransactions(): Promise<SpiirTransaction[]> {
    return cachedRequest(spiirCache.transactions, () => request<SpiirTransaction[]>("/api/spiir/transactions"));
}

export async function getSpiirIncomeExpenseSeries(): Promise<SpiirIncomeExpenseSeriesResponse> {
    return cachedRequest(spiirCache.incomeExpenseSeries, () => request<SpiirIncomeExpenseSeriesResponse>("/api/spiir/local-ledger/income-expense-series"));
}

export async function rebuildSpiirFromLocal(): Promise<{ generated_at: string; transaction_count: number; source: string }> {
    const result = await request<{ generated_at: string; transaction_count: number; source: string }>("/api/spiir/rebuild-from-local", {
        method: "POST"
    });
    invalidateSpiirCache();
    return result;
}

export async function scheduleSpiirRebuildFromLocal(delaySeconds = 10): Promise<{ scheduled: boolean; running: boolean; rebuild_required: boolean; delay_seconds?: number }> {
    return request<{ scheduled: boolean; running: boolean; rebuild_required: boolean; delay_seconds?: number }>(`/api/spiir/rebuild-from-local/schedule?delay_seconds=${delaySeconds}`, {
        method: "POST"
    });
}

export async function getSpiirLocalLedgerTransactions(): Promise<LedgerTransactionsResponse> {
    return cachedRequest(localLedgerCache.full, () => request<LedgerTransactionsResponse>("/api/spiir/local-ledger/transactions"));
}

export async function getSpiirLocalLedgerTransactionsPage(options?: { limit?: number; offset?: number }): Promise<LedgerTransactionsResponse> {
    if (options?.limit === undefined && options?.offset === undefined) {
        return getSpiirLocalLedgerTransactions();
    }
    if (localLedgerCache.full.value !== null) {
        return Promise.resolve(sliceLocalLedgerResponse(localLedgerCache.full.value, options));
    }
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
        params.set("limit", String(options.limit));
    }
    if (options?.offset !== undefined) {
        params.set("offset", String(options.offset));
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return cachedRequest(localLedgerPageSlot(options), () => request<LedgerTransactionsResponse>(`/api/spiir/local-ledger/transactions${suffix}`));
}

export async function saveSpiirLocalLedgerOverrides(transactionIds: string[], patch: LedgerOverridePatch): Promise<LedgerOverrideResponse> {
    const result = await request<LedgerOverrideResponse>("/api/spiir/local-ledger/overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_ids: transactionIds, patch })
    });
    patchLocalLedgerCache(result);
    return result;
}

export async function startLedgerRetrieveJob(): Promise<LedgerRetrieveJobStatus> {
    return request<LedgerRetrieveJobStatus>("/api/bank/retrieve/start", { method: "POST" });
}

export async function getLedgerRetrieveStatus(): Promise<LedgerRetrieveJobStatus> {
    return request<LedgerRetrieveJobStatus>("/api/bank/retrieve/status");
}

export async function getLedgerTaxonomy(): Promise<LedgerTaxonomyResponse> {
    return request<LedgerTaxonomyResponse>("/api/ledger/taxonomy");
}


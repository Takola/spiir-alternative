export interface SpiirOverviewRow {
    key: string;
    label: string;
    level: number;
    parent?: string | null;
    values: Record<string, number>;
    total: number;
    avg: number;
    kind?: string | null;
    categoryType?: string | null;
    mainCategoryName?: string | null;
    mainCategoryId?: string | number | null;
    categoryName?: string | null;
    categoryId?: string | number | null;
    hashtag?: string | null;
}

export interface SpiirOverviewSection {
    periods: string[];
    rows: SpiirOverviewRow[];
}

export interface SpiirUnknownTopEntry {
    desc_key: string;
    amount: number;
}

export interface SpiirSuspectEntry {
    date: string;
    amount: number;
    description: string;
    mainCategoryName: string;
    categoryName: string;
    categoryId?: string | number | null;
    mainCategoryId?: string | number | null;
    yyyymm: string;
}

export interface SpiirOverviewResponse {
    generated_at: string;
    monthly: SpiirOverviewSection;
    yearly: SpiirOverviewSection;
    shopping_extras: {
        unknownTop: SpiirUnknownTopEntry[];
        suspects: SpiirSuspectEntry[];
    };
}

export interface SpiirTransaction {
    yyyymm: string;
    year: string;
    ymd: string;
    amount: number;
    categoryType?: string | null;
    mainCategoryName?: string | null;
    categoryName?: string | null;
    categoryId?: string | number | null;
    mainCategoryId?: string | number | null;
    description?: string | null;
    comment?: string | null;
    hashtags: string[];
}

export interface SpiirStatusResponse {
    raw_exists: boolean;
    processed_exists: boolean;
    raw_file: string;
    processed_dir: string;
    update_log_file?: string;
    generated_at?: string | null;
    transaction_count: number;
    rebuild_required: boolean;
    rebuild_marked_at?: string | null;
    rebuild_reason?: string | null;
}

export interface SpiirIncomeExpenseMonth {
    month: string;
    income: number;
    expense: number;
    fixed_expense?: number | null;
    variable_expense?: number | null;
    net: number;
    income_count?: number | null;
    expense_count?: number | null;
    is_current_month: boolean;
    source: string;
}

export interface SpiirIncomeExpensePeriod {
    label: string;
    totals_title: string;
    start_month: string;
    end_month: string;
    months: string[];
}

export interface SpiirIncomeExpenseSeriesResponse {
    generated_at: string;
    source: string;
    source_generated_at?: string | null;
    months: SpiirIncomeExpenseMonth[];
    years: number[];
    periods: SpiirIncomeExpensePeriod[];
}

export interface NordeaTransaction {
    id: string;
    entry_reference: string;
    booking_date: string;
    transaction_date?: string | null;
    value_date?: string | null;
    amount: number;
    currency: string;
    description: string;
    remittance_information?: string | null;
    creditor_name?: string | null;
    debtor_name?: string | null;
    bank_transaction_code?: string | null;
    merchant_category_code?: string | null;
    status?: string | null;
    credit_debit_indicator?: string | null;
    account_iban?: string | null;
    account_name?: string | null;
    categoryType?: string | null;
    mainCategoryId?: string | number | null;
    mainCategoryName?: string | null;
    categoryId?: string | number | null;
    categoryName?: string | null;
    note?: string | null;
    hashtags: string[];
    is_extraordinary: boolean;
    pending_review?: boolean;
    original_booking_date?: string | null;
    custom_booking_date?: string | null;
    splits: NordeaSplitLine[];
    split_group_id?: string | null;
    split_line_id?: string | null;
    split_original_parent_id?: string | null;
    split_line_index?: number | null;
    source: string;
}

export interface NordeaCategoryOption {
    categoryType: string;
    mainCategoryId?: string | number | null;
    mainCategoryName: string;
    categoryId: string | number;
    categoryName: string;
    usage_count: number;
    search_aliases?: string[];
}

export interface NordeaHashtagOption {
    name: string;
    usage_count: number;
    last_seen: string;
}

export interface NordeaTaxonomyResponse {
    categories: NordeaCategoryOption[];
    hashtags: NordeaHashtagOption[];
}

export interface NordeaSplitLine {
    id: string;
    amount: number;
    note: string;
    category: NordeaCategoryOption;
}

export interface NordeaOverridePatch {
    category?: NordeaCategoryOption | null;
    booking_date?: string | null;
    note?: string;
    hashtags?: string[];
    append_hashtags?: string[];
    remove_hashtags?: string[];
    is_extraordinary?: boolean;
    pending_review?: boolean;
    splits?: NordeaSplitLine[];
}

export interface NordeaTransactionsResponse {
    generated_at?: string | null;
    last_retrieved_at?: string | null;
    last_retrieve_duration_seconds?: number | null;
    transaction_count: number;
    pending_review_count?: number;
    loaded_count?: number;
    offset?: number;
    limit?: number | null;
    has_more?: boolean;
    accounts: NordeaAccount[];
    transactions: NordeaTransaction[];
}

export interface NordeaAccount {
    account_id?: { iban?: string | null } | null;
    name?: string | null;
    product?: string | null;
    currency?: string | null;
    balance?: { amount?: number | string | null; currency?: string | null; updated_at?: string | null } | null;
}

export interface NordeaRetrieveResponse {
    retrieved_count: number;
    transaction_count: number;
    raw_files: string[];
    last_retrieved_at?: string | null;
    last_retrieve_duration_seconds?: number | null;
    fetch_window?: Record<string, unknown>;
}

export interface NordeaRetrieveEvent {
    at: string;
    label: string;
    progress: number;
    duration_seconds?: number;
    [key: string]: unknown;
}

export interface NordeaRetrieveJobStatus {
    job_id?: string | null;
    status: "idle" | "queued" | "running" | "succeeded" | "failed";
    started_at?: string | null;
    updated_at?: string | null;
    completed_at?: string | null;
    progress: number;
    current_phase?: string | null;
    events: NordeaRetrieveEvent[];
    result?: NordeaRetrieveResponse | null;
    sync_result?: {
        created_count: number;
        updated_count: number;
        autocategorized_count: number;
        skipped_before_cutover_count: number;
        skipped_missing_booking_date_count: number;
        ledger_row_count: number;
    } | null;
    error?: string | null;
}

export interface NordeaOverrideResponse {
    updated_count: number;
    updated_at: string;
    updated_transactions?: NordeaTransaction[];
    deleted_transaction_ids?: string[];
}


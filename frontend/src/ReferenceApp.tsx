import { Suspense, lazy, useEffect, useState } from "react";

const NordeaDashboard = lazy(() => import("./NordeaDashboard"));
const SpiirDashboard = lazy(() => import("./SpiirDashboard"));

type Tab = "nordea" | "spiir";

export default function ReferenceApp() {
    const [tab, setTab] = useState<Tab>("nordea");
    const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem("spiir-theme") === "dark");

    useEffect(() => {
        window.localStorage.setItem("spiir-theme", darkMode ? "dark" : "light");
        document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    }, [darkMode]);

    return <main className={`${tab === "nordea" ? "app-mode-nordea" : "app-shell app-shell-wide"} ${darkMode ? "theme-dark" : ""}`}>
        <nav className="top-nav-panel" aria-label="Reference navigation">
            <div className="top-nav-start">
                <strong>Spiir alternative</strong>
            </div>
            <div className="top-nav-controls">
                <button type="button" className={tab === "nordea" ? "nav-pill active" : "nav-pill"} onClick={() => setTab("nordea")}>Nordea ledger</button>
                <button type="button" className={tab === "spiir" ? "nav-pill active" : "nav-pill"} onClick={() => setTab("spiir")}>Overview</button>
                {tab === "spiir" ? <div id="spiir-header-controls" className="top-nav-spiir-controls" /> : null}
            </div>
            <div className="top-nav-actions">
                <button type="button" className="theme-toggle" onClick={() => setDarkMode((current) => !current)} aria-pressed={darkMode}>
                    <span aria-hidden="true">{darkMode ? "☀" : "◐"}</span>
                    {darkMode ? "Light" : "Dark"}
                </button>
            </div>
        </nav>
        <Suspense fallback={<div className="panel">Loading...</div>}>
            {tab === "nordea" ? <NordeaDashboard active={true} source="local-ledger" /> : null}
            {tab === "spiir" ? <SpiirDashboard active={true} /> : null}
        </Suspense>
    </main>;
}

/**
 * Entity Swapper Panel for Home Assistant
 * Pure HTMLElement — no LitElement dependency.
 */
class EntitySwapperPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._oldEntityId = "";
        this._newEntityId = "";
        this._loading = false;
        this._revertingId = null;
        this._history = [];
        this._rendered = false;
    }

    set panel(v) { this._panel = v; }
    set narrow(v) { this._narrow = v; }
    set route(v) { this._route = v; }

    set hass(hass) {
        this._hass = hass;
        if (!this._rendered) {
            this._rendered = true;
            this._render();
            this._loadHistory();
        }
        // Update entity lists for autocomplete
        if (this._oldInput) this._oldInput._hass = hass;
        if (this._newInput) this._newInput._hass = hass;
    }

    _getEntityList() {
        if (!this._hass || !this._hass.states) return [];
        return Object.keys(this._hass.states).sort();
    }

    _render() {
        const shadow = this.shadowRoot;
        shadow.innerHTML = `
<style>
    :host {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        min-height: 100vh;
        padding: 48px 16px;
        background: var(--primary-background-color, #fafafa);
        box-sizing: border-box;
        font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
    }
    * { box-sizing: border-box; }
    .card {
        background: var(--card-background-color, #fff);
        border-radius: 16px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.06);
        padding: 40px 36px;
        max-width: 680px;
        width: 100%;
    }
    h1 {
        font-size: 22px; font-weight: 500;
        color: var(--primary-text-color, #212121);
        margin: 0 0 6px; text-align: center;
    }
    .subtitle {
        font-size: 14px; color: var(--secondary-text-color, #727272);
        text-align: center; margin: 0 0 36px; line-height: 1.5;
    }
    .row {
        display: flex; align-items: center;
        gap: 16px; margin-bottom: 28px;
    }
    .col { flex: 1; min-width: 0; position: relative; }
    .lbl {
        display: block; font-size: 12px; font-weight: 500;
        text-transform: uppercase; letter-spacing: 0.5px;
        color: var(--secondary-text-color, #727272); margin-bottom: 8px;
    }
    .arrow {
        font-size: 22px; color: var(--primary-color, #03a9f4);
        margin-top: 22px; flex-shrink: 0; user-select: none;
    }
    .entity-input {
        width: 100%; padding: 10px 12px; font-size: 14px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 10px; outline: none;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        font-family: "Roboto Mono", "SF Mono", Consolas, monospace;
    }
    .entity-input:focus {
        border-color: var(--primary-color, #03a9f4);
        box-shadow: 0 0 0 1px var(--primary-color, #03a9f4);
    }
    .autocomplete-list {
        position: absolute; top: 100%; left: 0; right: 0;
        max-height: 220px; overflow-y: auto;
        background: var(--card-background-color, #fff);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 10px; margin-top: 4px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.10);
        z-index: 100; display: none;
    }
    .autocomplete-list.open { display: block; }
    .ac-item {
        padding: 8px 12px; cursor: pointer;
        font-size: 13px; color: var(--primary-text-color, #212121);
        font-family: "Roboto Mono", "SF Mono", Consolas, monospace;
        border-bottom: 1px solid var(--divider-color, #f0f0f0);
    }
    .ac-item:last-child { border-bottom: none; }
    .ac-item:hover, .ac-item.active {
        background: var(--primary-color, #03a9f4);
        color: #fff;
    }
    .ac-item .ac-friendly {
        font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        font-size: 11px; color: var(--secondary-text-color, #999);
        margin-left: 8px;
    }
    .ac-item:hover .ac-friendly, .ac-item.active .ac-friendly {
        color: rgba(255,255,255,0.7);
    }
    .go-btn {
        display: block; width: 100%; padding: 13px;
        font-size: 15px; font-weight: 500; letter-spacing: 0.4px;
        color: #fff; background: var(--primary-color, #03a9f4);
        border: none; border-radius: 12px; cursor: pointer;
        transition: opacity 0.15s, transform 0.1s;
    }
    .go-btn:hover:not([disabled]) { opacity: 0.92; }
    .go-btn:active:not([disabled]) { transform: scale(0.98); }
    .go-btn[disabled] { opacity: 0.4; cursor: not-allowed; }

    .results {
        margin-top: 28px; padding: 20px;
        background: var(--primary-background-color, #fafafa);
        border-radius: 12px; display: none;
    }
    .results.visible { display: block; }
    .results-title {
        font-size: 13px; font-weight: 500; text-transform: uppercase;
        letter-spacing: 0.5px; color: var(--secondary-text-color, #727272);
        margin: 0 0 14px;
    }
    .step {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 7px 0; font-size: 13px;
        color: var(--primary-text-color, #212121);
    }
    .step-icon { flex-shrink: 0; font-size: 15px; line-height: 1.3; }
    .step.success .step-icon { color: #4caf50; }
    .step.warning .step-icon { color: #ff9800; }
    .step.error .step-icon   { color: #f44336; }
    .step-text {
        font-family: "Roboto Mono", "SF Mono", Consolas, monospace;
        font-size: 12.5px; word-break: break-all;
    }
    .step-detail {
        font-size: 12px; color: var(--secondary-text-color, #727272);
        margin-top: 2px;
    }
    .summary {
        margin-top: 16px; padding: 14px; border-radius: 10px;
        font-size: 14px; text-align: center; font-weight: 500;
    }
    .summary.ok  { background: rgba(76,175,80,0.1); color: #2e7d32; }
    .summary.fail { background: rgba(244,67,54,0.1); color: #c62828; }

    .history {
        margin-top: 36px; border-top: 1px solid var(--divider-color, #e0e0e0);
        padding-top: 28px;
    }
    .history-title {
        font-size: 13px; font-weight: 500; text-transform: uppercase;
        letter-spacing: 0.5px; color: var(--secondary-text-color, #727272);
        margin: 0 0 16px;
    }
    .history-empty {
        font-size: 13px; color: var(--secondary-text-color, #727272);
        text-align: center; padding: 12px 0;
    }
    .history-item {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 12px; border-radius: 10px;
        background: var(--primary-background-color, #fafafa);
        margin-bottom: 8px;
    }
    .history-item:last-child { margin-bottom: 0; }
    .history-info { flex: 1; min-width: 0; }
    .history-entities {
        font-family: "Roboto Mono", "SF Mono", Consolas, monospace;
        font-size: 12.5px; color: var(--primary-text-color, #212121);
        word-break: break-all;
    }
    .history-date {
        font-size: 11px; color: var(--secondary-text-color, #999);
        margin-top: 3px;
    }
    .history-delete {
        background: none; border: none; cursor: pointer;
        padding: 6px; border-radius: 8px;
        color: var(--secondary-text-color, #999);
        transition: color 0.15s, background 0.15s;
        flex-shrink: 0; display: flex; align-items: center;
    }
    .history-delete:hover { color: #f44336; background: rgba(244,67,54,0.08); }
    .history-delete[disabled] { opacity: 0.3; cursor: not-allowed; }
    .history-delete svg { width: 18px; height: 18px; fill: currentColor; }

    @media (max-width: 560px) {
        .row { flex-direction: column; gap: 4px; }
        .arrow { margin-top: 0; transform: rotate(90deg); }
        .card { padding: 28px 20px; }
    }
</style>
<div class="card">
    <h1>Entity Swapper</h1>
    <p class="subtitle">
        Remplacez une entit\u00e9 d\u00e9fectueuse par une nouvelle.
        La nouvelle entit\u00e9 prendra l\u2019identifiant de l\u2019ancienne,
        pr\u00e9servant toutes vos automatisations et scripts.
    </p>
    <div class="row">
        <div class="col" id="col-old">
            <span class="lbl">Entit\u00e9 \u00e0 remplacer</span>
            <input class="entity-input" id="input-old" autocomplete="off" placeholder="switch.exemple" />
            <div class="autocomplete-list" id="ac-old"></div>
        </div>
        <div class="arrow">\u2192</div>
        <div class="col" id="col-new">
            <span class="lbl">Nouvelle entit\u00e9</span>
            <input class="entity-input" id="input-new" autocomplete="off" placeholder="switch.exemple_2" />
            <div class="autocomplete-list" id="ac-new"></div>
        </div>
    </div>
    <button class="go-btn" id="go-btn" disabled>GO</button>
    <div class="results" id="results"></div>
    <div class="history" id="history"></div>
</div>`;

        // --- Wire up autocomplete ---
        this._oldInput = shadow.getElementById("input-old");
        this._newInput = shadow.getElementById("input-new");
        this._acOld = shadow.getElementById("ac-old");
        this._acNew = shadow.getElementById("ac-new");
        this._goBtn = shadow.getElementById("go-btn");
        this._resultsEl = shadow.getElementById("results");
        this._historyEl = shadow.getElementById("history");

        this._setupAutocomplete(this._oldInput, this._acOld, (v) => { this._oldEntityId = v; this._syncBtn(); });
        this._setupAutocomplete(this._newInput, this._acNew, (v) => { this._newEntityId = v; this._syncBtn(); });

        this._goBtn.addEventListener("click", () => this._doSwap());

        // Close autocompletes on outside click
        shadow.addEventListener("click", (e) => {
            if (!this._acOld.contains(e.target) && e.target !== this._oldInput) this._acOld.classList.remove("open");
            if (!this._acNew.contains(e.target) && e.target !== this._newInput) this._acNew.classList.remove("open");
        });
    }

    _setupAutocomplete(input, list, onSelect) {
        let activeIdx = -1;

        const showList = () => {
            const val = input.value.toLowerCase().trim();
            const entities = this._getEntityList();
            const words = val.split(/\s+/).filter(Boolean);
            const filtered = words.length > 0
                ? entities.filter((eid) => {
                      const friendly = (this._hass && this._hass.states[eid] && this._hass.states[eid].attributes.friendly_name || "").toLowerCase();
                      const haystack = eid.toLowerCase() + " " + friendly;
                      return words.every((w) => haystack.includes(w));
                  }).slice(0, 50)
                : entities.slice(0, 50);
            list.innerHTML = "";
            activeIdx = -1;
            if (filtered.length === 0) { list.classList.remove("open"); return; }
            for (const eid of filtered) {
                const item = document.createElement("div");
                item.className = "ac-item";
                const friendly = this._hass && this._hass.states[eid]
                    ? this._hass.states[eid].attributes.friendly_name || ""
                    : "";
                item.innerHTML = eid + (friendly ? '<span class="ac-friendly">' + friendly.replace(/</g, "&lt;") + '</span>' : '');
                item.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    input.value = eid;
                    onSelect(eid);
                    list.classList.remove("open");
                });
                list.appendChild(item);
            }
            list.classList.add("open");
        };

        input.addEventListener("focus", showList);
        input.addEventListener("input", () => { onSelect(input.value); showList(); });
        input.addEventListener("blur", () => { setTimeout(() => list.classList.remove("open"), 150); });

        input.addEventListener("keydown", (e) => {
            const items = list.querySelectorAll(".ac-item");
            if (!items.length) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                activeIdx = Math.min(activeIdx + 1, items.length - 1);
                items.forEach((it, i) => it.classList.toggle("active", i === activeIdx));
                items[activeIdx].scrollIntoView({ block: "nearest" });
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                activeIdx = Math.max(activeIdx - 1, 0);
                items.forEach((it, i) => it.classList.toggle("active", i === activeIdx));
                items[activeIdx].scrollIntoView({ block: "nearest" });
            } else if (e.key === "Enter" && activeIdx >= 0) {
                e.preventDefault();
                const val = input.value.toLowerCase().trim();
                const words = val.split(/\s+/).filter(Boolean);
                const match = this._getEntityList().filter((eid) => {
                    const friendly = (this._hass && this._hass.states[eid] && this._hass.states[eid].attributes.friendly_name || "").toLowerCase();
                    const haystack = eid.toLowerCase() + " " + friendly;
                    return words.every((w) => haystack.includes(w));
                })[activeIdx];
                if (match) { input.value = match; onSelect(match); }
                list.classList.remove("open");
            } else if (e.key === "Escape") {
                list.classList.remove("open");
            }
        });
    }

    _syncBtn() {
        this._goBtn.disabled = !this._oldEntityId || !this._newEntityId || this._loading;
    }

    // --- Swap ---
    async _doSwap() {
        if (!this._oldEntityId || !this._newEntityId || this._loading) return;
        this._loading = true;
        this._goBtn.disabled = true;
        this._goBtn.textContent = "\u2026";
        this._resultsEl.className = "results";
        this._resultsEl.innerHTML = "";

        try {
            const result = await this._hass.callWS({
                type: "entity_swapper/swap",
                old_entity_id: this._oldEntityId,
                new_entity_id: this._newEntityId,
            });
            this._showResult(result);
            if (result.success) this._loadHistory();
        } catch (err) {
            this._showError(err.message || String(err));
        } finally {
            this._loading = false;
            this._goBtn.textContent = "GO";
            this._syncBtn();
        }
    }

    // --- Revert ---
    async _doRevert(swapId) {
        if (this._revertingId) return;
        this._revertingId = swapId;
        // Disable the revert button
        const btn = this.shadowRoot.querySelector('[data-swap-id="' + swapId + '"]');
        if (btn) btn.disabled = true;

        try {
            const result = await this._hass.callWS({
                type: "entity_swapper/revert",
                swap_id: swapId,
            });
            this._showResult(result);
            this._loadHistory();
        } catch (err) {
            this._showError(err.message || String(err));
        } finally {
            this._revertingId = null;
        }
    }

    // --- Results display ---
    _showResult(result) {
        this._resultsEl.innerHTML = "";
        this._resultsEl.className = "results visible";

        const h = document.createElement("p");
        h.className = "results-title";
        h.textContent = "Compte rendu";
        this._resultsEl.appendChild(h);

        if (result.steps) {
            for (const s of result.steps) {
                const row = document.createElement("div");
                row.className = "step " + s.status;
                const icon = document.createElement("span");
                icon.className = "step-icon";
                icon.textContent = s.status === "success" ? "\u2713" : s.status === "warning" ? "\u26a0" : "\u2717";
                row.appendChild(icon);
                const body = document.createElement("div");
                const txt = document.createElement("div");
                txt.className = "step-text";
                txt.textContent = s.action;
                body.appendChild(txt);
                if (s.detail) {
                    const det = document.createElement("div");
                    det.className = "step-detail";
                    det.textContent = s.detail;
                    body.appendChild(det);
                }
                row.appendChild(body);
                this._resultsEl.appendChild(row);
            }
        }

        const summary = document.createElement("div");
        if (result.success) {
            summary.className = "summary ok";
            summary.textContent = "\u2713 Swap termin\u00e9 ! " + (result.summary ? result.summary.new_controls_as + " est maintenant contr\u00f4l\u00e9 par le nouveau dispositif." : "Op\u00e9ration r\u00e9ussie.");
        } else {
            summary.className = "summary fail";
            summary.textContent = "\u2717 " + (result.error || "\u00c9chec du swap.");
        }
        this._resultsEl.appendChild(summary);
    }

    _showError(message) {
        this._resultsEl.innerHTML = "";
        this._resultsEl.className = "results visible";
        const div = document.createElement("div");
        div.className = "summary fail";
        div.textContent = "\u2717 " + message;
        this._resultsEl.appendChild(div);
    }

    // --- History ---
    async _loadHistory() {
        try {
            this._history = await this._hass.callWS({ type: "entity_swapper/history" });
        } catch (_) {
            this._history = [];
        }
        this._renderHistory();
    }

    _renderHistory() {
        const el = this._historyEl;
        el.innerHTML = "";

        const title = document.createElement("p");
        title.className = "history-title";
        title.textContent = "Historique des swaps";
        el.appendChild(title);

        if (this._history.length === 0) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = "Aucun swap enregistr\u00e9";
            el.appendChild(empty);
            return;
        }

        for (const item of this._history) {
            const row = document.createElement("div");
            row.className = "history-item";

            const info = document.createElement("div");
            info.className = "history-info";

            const entities = document.createElement("div");
            entities.className = "history-entities";
            entities.textContent = item.original_entity_id + " \u2190 " + item.new_device_original_id;
            info.appendChild(entities);

            const d = new Date(item.timestamp * 1000);
            const dateDiv = document.createElement("div");
            dateDiv.className = "history-date";
            dateDiv.textContent = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
                + " \u00e0 " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
            info.appendChild(dateDiv);

            row.appendChild(info);

            const btn = document.createElement("button");
            btn.className = "history-delete";
            btn.title = "Annuler ce swap";
            btn.setAttribute("data-swap-id", item.id);
            btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            btn.addEventListener("click", () => this._doRevert(item.id));
            row.appendChild(btn);

            el.appendChild(row);
        }
    }
}

customElements.define("entity-swapper-panel", EntitySwapperPanel);

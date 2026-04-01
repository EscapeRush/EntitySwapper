/**
 * Entity Swapper Panel for Home Assistant
 * Uses LitElement so ha-entity-picker works natively.
 */

function findLitBase() {
    const candidates = [
        "ha-panel-lovelace",
        "hui-masonry-view",
        "hui-view",
        "hc-lovelace",
        "hui-error-card",
        "ha-config-dashboard",
        "ha-panel-config",
        "ha-panel-developer-tools",
    ];
    for (const tag of candidates) {
        const el = customElements.get(tag);
        if (el) {
            const base = Object.getPrototypeOf(el);
            if (base && base.prototype && base.prototype.html) return base;
        }
    }
    return null;
}

async function loadAndDefine() {
    let base = findLitBase();

    if (!base) {
        // Force-load card helpers which registers many Lit components
        try {
            if (window.loadCardHelpers) await window.loadCardHelpers();
        } catch (_) {}
        base = findLitBase();
    }

    if (!base) {
        // Last resort: wait for any Lit element to appear
        await new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                base = findLitBase();
                if (base) { observer.disconnect(); resolve(); }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { observer.disconnect(); resolve(); }, 5000);
        });
        if (!base) base = findLitBase();
    }

    if (!base) {
        console.error("Entity Swapper: could not find LitElement base class");
        return;
    }

    const { html, css } = base.prototype.constructor;

    class EntitySwapperPanel extends base {
    static get properties() {
        return {
            hass: { type: Object },
            narrow: { type: Boolean },
            panel: { type: Object },
            _oldEntityId: { type: String },
            _newEntityId: { type: String },
            _loading: { type: Boolean },
            _result: { type: Object },
            _history: { type: Array },
            _revertingId: { type: String },
        };
    }

    constructor() {
        super();
        this._oldEntityId = "";
        this._newEntityId = "";
        this._loading = false;
        this._result = null;
        this._history = [];
        this._revertingId = null;
    }

    static get styles() {
        return css`
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
            .card {
                background: var(--card-background-color, #fff);
                border-radius: 16px;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
                padding: 40px 36px;
                max-width: 680px;
                width: 100%;
            }
            h1 {
                font-size: 22px;
                font-weight: 500;
                color: var(--primary-text-color, #212121);
                margin: 0 0 6px;
                text-align: center;
            }
            .subtitle {
                font-size: 14px;
                color: var(--secondary-text-color, #727272);
                text-align: center;
                margin: 0 0 36px;
                line-height: 1.5;
            }
            .row {
                display: flex;
                align-items: center;
                gap: 16px;
                margin-bottom: 28px;
            }
            .col {
                flex: 1;
                min-width: 0;
            }
            label {
                display: block;
                font-size: 12px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--secondary-text-color, #727272);
                margin-bottom: 8px;
            }
            .arrow {
                font-size: 22px;
                color: var(--primary-color, #03a9f4);
                margin-top: 22px;
                flex-shrink: 0;
            }
            ha-entity-picker {
                display: block;
                width: 100%;
            }
            .go-btn {
                display: block;
                width: 100%;
                padding: 13px;
                font-size: 15px;
                font-weight: 500;
                letter-spacing: 0.4px;
                color: #fff;
                background: var(--primary-color, #03a9f4);
                border: none;
                border-radius: 12px;
                cursor: pointer;
                transition: opacity 0.15s, transform 0.1s;
            }
            .go-btn:hover:not([disabled]) { opacity: 0.92; }
            .go-btn:active:not([disabled]) { transform: scale(0.98); }
            .go-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
            .results {
                margin-top: 28px;
                padding: 20px;
                background: var(--primary-background-color, #fafafa);
                border-radius: 12px;
            }
            .results-title {
                font-size: 13px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--secondary-text-color, #727272);
                margin: 0 0 14px;
            }
            .step {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 7px 0;
                font-size: 13px;
                color: var(--primary-text-color, #212121);
            }
            .step-icon { flex-shrink: 0; font-size: 15px; line-height: 1.3; }
            .step.success .step-icon { color: #4caf50; }
            .step.warning .step-icon { color: #ff9800; }
            .step.error .step-icon   { color: #f44336; }
            .step-text {
                font-family: "Roboto Mono", "SF Mono", Consolas, monospace;
                font-size: 12.5px;
                word-break: break-all;
            }
            .step-detail {
                font-size: 12px;
                color: var(--secondary-text-color, #727272);
                margin-top: 2px;
            }
            .summary {
                margin-top: 16px;
                padding: 14px;
                border-radius: 10px;
                font-size: 14px;
                text-align: center;
                font-weight: 500;
            }
            .summary.ok  { background: rgba(76,175,80,0.1); color: #2e7d32; }
            .summary.fail { background: rgba(244,67,54,0.1); color: #c62828; }

            /* History */
            .history {
                margin-top: 36px;
                border-top: 1px solid var(--divider-color, #e0e0e0);
                padding-top: 28px;
            }
            .history-title {
                font-size: 13px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--secondary-text-color, #727272);
                margin: 0 0 16px;
            }
            .history-empty {
                font-size: 13px;
                color: var(--secondary-text-color, #727272);
                text-align: center;
                padding: 12px 0;
            }
            .history-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 12px;
                border-radius: 10px;
                background: var(--primary-background-color, #fafafa);
                margin-bottom: 8px;
            }
            .history-item:last-child { margin-bottom: 0; }
            .history-info {
                flex: 1;
                min-width: 0;
            }
            .history-entities {
                font-family: "Roboto Mono", "SF Mono", Consolas, monospace;
                font-size: 12.5px;
                color: var(--primary-text-color, #212121);
                word-break: break-all;
            }
            .history-date {
                font-size: 11px;
                color: var(--secondary-text-color, #999);
                margin-top: 3px;
            }
            .history-delete {
                background: none;
                border: none;
                cursor: pointer;
                padding: 6px;
                border-radius: 8px;
                color: var(--secondary-text-color, #999);
                transition: color 0.15s, background 0.15s;
                flex-shrink: 0;
                display: flex;
                align-items: center;
            }
            .history-delete:hover {
                color: #f44336;
                background: rgba(244, 67, 54, 0.08);
            }
            .history-delete[disabled] {
                opacity: 0.3;
                cursor: not-allowed;
            }
            .history-delete svg {
                width: 18px;
                height: 18px;
                fill: currentColor;
            }

            @media (max-width: 560px) {
                .row { flex-direction: column; gap: 4px; }
                .arrow { margin-top: 0; transform: rotate(90deg); }
                .card { padding: 28px 20px; }
            }
        `;
    }

    render() {
        return html`
            <div class="card">
                <h1>Entity Swapper</h1>
                <p class="subtitle">
                    Remplacez une entit\u00e9 d\u00e9fectueuse par une nouvelle.
                    La nouvelle entit\u00e9 prendra l'identifiant de l'ancienne,
                    pr\u00e9servant toutes vos automatisations et scripts.
                </p>
                <div class="row">
                    <div class="col">
                        <label>Entit\u00e9 \u00e0 remplacer</label>
                        <ha-entity-picker
                            .hass=${this.hass}
                            .value=${this._oldEntityId}
                            @value-changed=${this._oldChanged}
                            allow-custom-entity
                        ></ha-entity-picker>
                    </div>
                    <div class="arrow">\u2192</div>
                    <div class="col">
                        <label>Nouvelle entit\u00e9</label>
                        <ha-entity-picker
                            .hass=${this.hass}
                            .value=${this._newEntityId}
                            @value-changed=${this._newChanged}
                            allow-custom-entity
                        ></ha-entity-picker>
                    </div>
                </div>
                <button
                    class="go-btn"
                    ?disabled=${!this._oldEntityId || !this._newEntityId || this._loading}
                    @click=${this._doSwap}
                >${this._loading ? "\u2026" : "GO"}</button>
                ${this._result ? this._renderResult() : ""}
                ${this._renderHistory()}
            </div>
        `;
    }

    _oldChanged(e) {
        this._oldEntityId = e.detail.value || "";
    }

    _newChanged(e) {
        this._newEntityId = e.detail.value || "";
    }

    _renderResult() {
        const r = this._result;
        return html`
            <div class="results">
                <p class="results-title">Compte rendu</p>
                ${(r.steps || []).map(
                    (s) => html`
                        <div class="step ${s.status}">
                            <span class="step-icon">${s.status === "success" ? "\u2713" : s.status === "warning" ? "\u26a0" : "\u2717"}</span>
                            <div>
                                <div class="step-text">${s.action}</div>
                                ${s.detail ? html`<div class="step-detail">${s.detail}</div>` : ""}
                            </div>
                        </div>
                    `
                )}
                ${r.success
                    ? html`<div class="summary ok">\u2713 Swap termin\u00e9 ! ${r.summary.new_controls_as} est maintenant contr\u00f4l\u00e9 par le nouveau dispositif.</div>`
                    : html`<div class="summary fail">\u2717 ${r.error || "\u00c9chec du swap."}</div>`}
            </div>
        `;
    }

    _renderHistory() {
        return html`
            <div class="history">
                <p class="history-title">Historique des swaps</p>
                ${this._history.length === 0
                    ? html`<div class="history-empty">Aucun swap enregistr\u00e9</div>`
                    : this._history.map((item) => {
                          const d = new Date(item.timestamp * 1000);
                          const dateStr = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
                              + " \u00e0 " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                          return html`
                              <div class="history-item">
                                  <div class="history-info">
                                      <div class="history-entities">
                                          ${item.original_entity_id}
                                          \u2190 ${item.new_device_original_id}
                                      </div>
                                      <div class="history-date">${dateStr}</div>
                                  </div>
                                  <button
                                      class="history-delete"
                                      title="Annuler ce swap"
                                      ?disabled=${this._revertingId === item.id}
                                      @click=${() => this._doRevert(item.id)}
                                  >
                                      <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                  </button>
                              </div>
                          `;
                      })
                }
            </div>
        `;
    }

    connectedCallback() {
        super.connectedCallback();
        this._loadHistory();
    }

    async _loadHistory() {
        try {
            this._history = await this.hass.callWS({ type: "entity_swapper/history" });
        } catch (_) {
            this._history = [];
        }
    }

    async _doSwap() {
        if (!this._oldEntityId || !this._newEntityId || this._loading) return;
        this._loading = true;
        this._result = null;
        try {
            const result = await this.hass.callWS({
                type: "entity_swapper/swap",
                old_entity_id: this._oldEntityId,
                new_entity_id: this._newEntityId,
            });
            this._result = result;
            if (result.success) await this._loadHistory();
        } catch (err) {
            this._result = { success: false, steps: [], error: err.message || String(err) };
        } finally {
            this._loading = false;
        }
    }

    async _doRevert(swapId) {
        this._revertingId = swapId;
        try {
            const result = await this.hass.callWS({
                type: "entity_swapper/revert",
                swap_id: swapId,
            });
            this._result = result;
            await this._loadHistory();
        } catch (err) {
            this._result = { success: false, steps: [], error: err.message || String(err) };
        } finally {
            this._revertingId = null;
        }
    }
}

    customElements.define("entity-swapper-panel", EntitySwapperPanel);
}

loadAndDefine();

/**
 * Entity Swapper Panel for Home Assistant
 * Provides a clean UI to swap entity IDs between two devices.
 */
class EntitySwapperPanel extends HTMLElement {
    constructor() {
        super();
        this._initialized = false;
        this._oldEntityId = "";
        this._newEntityId = "";
        this._loading = false;
    }

    set panel(panel) {
        this._panel = panel;
    }
    set narrow(narrow) {
        this._narrow = narrow;
    }
    set route(route) {
        this._route = route;
    }

    set hass(hass) {
        this._hass = hass;
        if (!this._initialized) {
            this._initialized = true;
            this._boot();
        }
        if (this._oldPicker) this._oldPicker.hass = hass;
        if (this._newPicker) this._newPicker.hass = hass;
    }

    async _boot() {
        // Ensure ha-entity-picker is loaded
        if (!customElements.get("ha-entity-picker")) {
            try {
                if (window.loadCardHelpers) {
                    await window.loadCardHelpers();
                }
            } catch (_) {}
            if (!customElements.get("ha-entity-picker")) {
                await Promise.race([
                    customElements.whenDefined("ha-entity-picker"),
                    new Promise((r) => setTimeout(r, 3000)),
                ]);
            }
        }
        this._render();
    }

    _render() {
        this.innerHTML = "";

        // --- Styles ---
        const style = document.createElement("style");
        style.textContent = `
            .es-wrap {
                display: flex;
                justify-content: center;
                align-items: flex-start;
                min-height: 100vh;
                padding: 48px 16px;
                background: var(--primary-background-color, #fafafa);
                box-sizing: border-box;
                font-family: var(--paper-font-body1_-_font-family, "Roboto", sans-serif);
            }
            .es-card {
                background: var(--card-background-color, #fff);
                border-radius: 16px;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
                padding: 40px 36px;
                max-width: 680px;
                width: 100%;
            }
            .es-title {
                font-size: 22px;
                font-weight: 500;
                color: var(--primary-text-color, #212121);
                margin: 0 0 6px 0;
                text-align: center;
                letter-spacing: -0.2px;
            }
            .es-subtitle {
                font-size: 14px;
                color: var(--secondary-text-color, #727272);
                text-align: center;
                margin: 0 0 36px 0;
                line-height: 1.5;
            }
            .es-row {
                display: flex;
                align-items: center;
                gap: 16px;
                margin-bottom: 28px;
            }
            .es-col {
                flex: 1;
                min-width: 0;
            }
            .es-label {
                display: block;
                font-size: 12px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--secondary-text-color, #727272);
                margin-bottom: 8px;
            }
            .es-arrow {
                font-size: 22px;
                color: var(--primary-color, #03a9f4);
                margin-top: 22px;
                flex-shrink: 0;
                user-select: none;
            }
            ha-entity-picker {
                display: block;
                width: 100%;
            }
            .es-go {
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
            .es-go:hover:not(:disabled) {
                opacity: 0.92;
            }
            .es-go:active:not(:disabled) {
                transform: scale(0.98);
            }
            .es-go:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            /* Results */
            .es-results {
                margin-top: 28px;
                padding: 20px;
                background: var(--primary-background-color, #fafafa);
                border-radius: 12px;
                display: none;
            }
            .es-results.visible {
                display: block;
            }
            .es-results-title {
                font-size: 13px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: var(--secondary-text-color, #727272);
                margin: 0 0 14px 0;
            }
            .es-step {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 7px 0;
                font-size: 13px;
                color: var(--primary-text-color, #212121);
            }
            .es-step-icon {
                flex-shrink: 0;
                font-size: 15px;
                line-height: 1.3;
            }
            .es-step.success .es-step-icon { color: #4caf50; }
            .es-step.warning .es-step-icon { color: #ff9800; }
            .es-step.error .es-step-icon   { color: #f44336; }
            .es-step-text {
                font-family: "Roboto Mono", "SF Mono", "Consolas", monospace;
                font-size: 12.5px;
                word-break: break-all;
            }
            .es-step-detail {
                font-family: var(--paper-font-body1_-_font-family, "Roboto", sans-serif);
                font-size: 12px;
                color: var(--secondary-text-color, #727272);
                margin-top: 2px;
            }
            .es-summary {
                margin-top: 16px;
                padding: 14px;
                border-radius: 10px;
                font-size: 14px;
                text-align: center;
                font-weight: 500;
            }
            .es-summary.ok {
                background: rgba(76, 175, 80, 0.1);
                color: #2e7d32;
            }
            .es-summary.fail {
                background: rgba(244, 67, 54, 0.1);
                color: #c62828;
            }

            /* Responsive */
            @media (max-width: 560px) {
                .es-row {
                    flex-direction: column;
                    gap: 4px;
                }
                .es-arrow {
                    margin-top: 0;
                    transform: rotate(90deg);
                }
                .es-card {
                    padding: 28px 20px;
                }
            }
        `;
        this.appendChild(style);

        // --- Layout ---
        const wrap = document.createElement("div");
        wrap.className = "es-wrap";

        const card = document.createElement("div");
        card.className = "es-card";

        // Title
        const title = document.createElement("h1");
        title.className = "es-title";
        title.textContent = "Entity Swapper";
        card.appendChild(title);

        // Subtitle
        const sub = document.createElement("p");
        sub.className = "es-subtitle";
        sub.textContent =
            "Remplacez une entité défectueuse par une nouvelle. " +
            "La nouvelle entité prendra l'identifiant de l'ancienne, " +
            "préservant toutes vos automatisations et scripts.";
        card.appendChild(sub);

        // Pickers row
        const row = document.createElement("div");
        row.className = "es-row";

        // -- Old picker --
        const colOld = document.createElement("div");
        colOld.className = "es-col";
        const lblOld = document.createElement("label");
        lblOld.className = "es-label";
        lblOld.textContent = "Entité à remplacer";
        colOld.appendChild(lblOld);

        this._oldPicker = document.createElement("ha-entity-picker");
        this._oldPicker.hass = this._hass;
        this._oldPicker.autofocus = true;
        this._oldPicker.addEventListener("value-changed", (e) => {
            this._oldEntityId = e.detail.value || "";
            this._syncButton();
        });
        colOld.appendChild(this._oldPicker);
        row.appendChild(colOld);

        // Arrow
        const arrow = document.createElement("div");
        arrow.className = "es-arrow";
        arrow.textContent = "→";
        row.appendChild(arrow);

        // -- New picker --
        const colNew = document.createElement("div");
        colNew.className = "es-col";
        const lblNew = document.createElement("label");
        lblNew.className = "es-label";
        lblNew.textContent = "Nouvelle entité";
        colNew.appendChild(lblNew);

        this._newPicker = document.createElement("ha-entity-picker");
        this._newPicker.hass = this._hass;
        this._newPicker.addEventListener("value-changed", (e) => {
            this._newEntityId = e.detail.value || "";
            this._syncButton();
        });
        colNew.appendChild(this._newPicker);
        row.appendChild(colNew);

        card.appendChild(row);

        // GO button
        this._btn = document.createElement("button");
        this._btn.className = "es-go";
        this._btn.textContent = "GO";
        this._btn.disabled = true;
        this._btn.addEventListener("click", () => this._doSwap());
        card.appendChild(this._btn);

        // Results area
        this._resultsEl = document.createElement("div");
        this._resultsEl.className = "es-results";
        card.appendChild(this._resultsEl);

        wrap.appendChild(card);
        this.appendChild(wrap);
    }

    _syncButton() {
        if (!this._btn) return;
        this._btn.disabled =
            !this._oldEntityId || !this._newEntityId || this._loading;
    }

    async _doSwap() {
        if (!this._oldEntityId || !this._newEntityId || this._loading) return;

        this._loading = true;
        this._btn.disabled = true;
        this._btn.textContent = "…";
        this._resultsEl.className = "es-results";
        this._resultsEl.innerHTML = "";

        try {
            const result = await this._hass.callWS({
                type: "entity_swapper/swap",
                old_entity_id: this._oldEntityId,
                new_entity_id: this._newEntityId,
            });
            this._displayResult(result);
        } catch (err) {
            this._displayError(err.message || String(err));
        } finally {
            this._loading = false;
            this._btn.textContent = "GO";
            this._syncButton();
        }
    }

    _displayResult(result) {
        this._resultsEl.innerHTML = "";
        this._resultsEl.className = "es-results visible";

        const heading = document.createElement("p");
        heading.className = "es-results-title";
        heading.textContent = "Compte rendu";
        this._resultsEl.appendChild(heading);

        if (result.steps) {
            for (const step of result.steps) {
                const div = document.createElement("div");
                div.className = "es-step " + step.status;

                const icon = document.createElement("span");
                icon.className = "es-step-icon";
                icon.textContent =
                    step.status === "success"
                        ? "✓"
                        : step.status === "warning"
                          ? "⚠"
                          : "✗";
                div.appendChild(icon);

                const body = document.createElement("div");

                const text = document.createElement("div");
                text.className = "es-step-text";
                text.textContent = step.action;
                body.appendChild(text);

                if (step.detail) {
                    const detail = document.createElement("div");
                    detail.className = "es-step-detail";
                    detail.textContent = step.detail;
                    body.appendChild(detail);
                }

                div.appendChild(body);
                this._resultsEl.appendChild(div);
            }
        }

        const summary = document.createElement("div");
        if (result.success) {
            summary.className = "es-summary ok";
            summary.textContent =
                "✓  Swap terminé ! " +
                result.summary.new_controls_as +
                " est maintenant contrôlé par le nouveau dispositif.";
        } else {
            summary.className = "es-summary fail";
            summary.textContent = "✗  " + (result.error || "Échec du swap.");
        }
        this._resultsEl.appendChild(summary);
    }

    _displayError(message) {
        this._resultsEl.innerHTML = "";
        this._resultsEl.className = "es-results visible";

        const div = document.createElement("div");
        div.className = "es-summary fail";
        div.textContent = "✗  " + message;
        this._resultsEl.appendChild(div);
    }
}

customElements.define("entity-swapper-panel", EntitySwapperPanel);

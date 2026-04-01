"""Entity Swapper - Swap entity IDs in Home Assistant."""

import json
import logging
import os
import time
import uuid

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import (
    async_register_built_in_panel,
    async_remove_panel,
)
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
HISTORY_FILE = "entity_swapper_history.json"


def _history_path(hass: HomeAssistant) -> str:
    """Return the path to the history JSON file."""
    return os.path.join(hass.config.config_dir, HISTORY_FILE)


def _load_history(hass: HomeAssistant) -> list:
    path = _history_path(hass)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_history(hass: HomeAssistant, history: list) -> None:
    path = _history_path(hass)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Entity Swapper component."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Entity Swapper from a config entry."""
    # Serve the frontend panel JS
    await hass.http.async_register_static_paths(
        [StaticPathConfig("/entity_swapper", FRONTEND_DIR, cache_headers=False)]
    )

    # Register the sidebar panel
    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title="Entity Swapper",
        sidebar_icon="mdi:swap-horizontal",
        frontend_url_path="entity-swapper",
        config={
            "_panel_custom": {
                "name": "entity-swapper-panel",
                "js_url": "/entity_swapper/entity-swapper-panel.js",
                "embed_iframe": False,
                "trust_external": False,
            }
        },
        require_admin=True,
    )

    # Register websocket commands
    websocket_api.async_register_command(hass, ws_swap_entities)
    websocket_api.async_register_command(hass, ws_swap_history)
    websocket_api.async_register_command(hass, ws_swap_revert)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Entity Swapper."""
    async_remove_panel(hass, "entity-swapper")
    return True


def _find_available_id(registry: er.EntityRegistry, base_id: str, suffix: str) -> str:
    """Find an available entity ID with the given suffix."""
    candidate = f"{base_id}_{suffix}"
    if not registry.async_get(candidate):
        return candidate
    for i in range(2, 1000):
        candidate = f"{base_id}_{suffix}_{i}"
        if not registry.async_get(candidate):
            return candidate
    return candidate


@websocket_api.websocket_command(
    {
        vol.Required("type"): "entity_swapper/swap",
        vol.Required("old_entity_id"): str,
        vol.Required("new_entity_id"): str,
    }
)
@websocket_api.async_response
async def ws_swap_entities(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Handle entity swap via websocket."""
    old_entity_id = msg["old_entity_id"]
    new_entity_id = msg["new_entity_id"]

    # --- Validation ---
    if old_entity_id == new_entity_id:
        connection.send_error(
            msg["id"], "invalid", "Les deux entités sont identiques."
        )
        return

    old_domain = old_entity_id.split(".")[0]
    new_domain = new_entity_id.split(".")[0]
    if old_domain != new_domain:
        connection.send_error(
            msg["id"],
            "domain_mismatch",
            f"Les domaines doivent être identiques ({old_domain} ≠ {new_domain}). "
            f"Impossible de transformer un '{new_domain}' en '{old_domain}'.",
        )
        return

    registry = er.async_get(hass)

    new_entry = registry.async_get(new_entity_id)
    if not new_entry:
        connection.send_error(
            msg["id"],
            "not_found",
            f"L'entité '{new_entity_id}' n'est pas dans le registre. "
            f"Seules les entités créées par une intégration (avec un unique_id) "
            f"peuvent être renommées. Les entités YAML sans unique_id ne sont pas supportées.",
        )
        return

    old_entry = registry.async_get(old_entity_id)
    steps = []
    final_old_id = None

    if old_entry:
        # --- Step 1: old_entity → _old ---
        final_old_id = _find_available_id(registry, old_entity_id, "old")
        try:
            registry.async_update_entity(old_entity_id, new_entity_id=final_old_id)
            steps.append(
                {
                    "action": f"{old_entity_id}  →  {final_old_id}",
                    "status": "success",
                    "detail": "Ancienne entité renommée avec suffixe _old",
                }
            )
        except Exception as exc:
            connection.send_error(
                msg["id"],
                "rename_failed",
                f"Impossible de renommer '{old_entity_id}' : {exc}",
            )
            return
    elif hass.states.get(old_entity_id):
        # Entity exists in states but not in registry (no unique_id)
        connection.send_error(
            msg["id"],
            "not_in_registry",
            f"L'entité '{old_entity_id}' existe mais n'est pas dans le registre "
            f"(pas de unique_id). Supprimez-la d'abord ou utilisez une entité "
            f"issue d'une intégration.",
        )
        return
    else:
        # Old entity is completely gone — ID is free
        steps.append(
            {
                "action": f"{old_entity_id} n'existe plus",
                "status": "info",
                "detail": "L'identifiant est libre, pas besoin de le libérer",
            }
        )

    # --- Step 2: new_entity → old_entity_id ---
    try:
        registry.async_update_entity(new_entity_id, new_entity_id=old_entity_id)
        steps.append(
            {
                "action": f"{new_entity_id}  →  {old_entity_id}",
                "status": "success",
                "detail": "Nouvelle entité prend l'identifiant de l'ancienne",
            }
        )
    except Exception as exc:
        # Rollback step 1
        try:
            registry.async_update_entity(final_old_id, new_entity_id=old_entity_id)
            steps.append(
                {
                    "action": f"Rollback : {final_old_id}  →  {old_entity_id}",
                    "status": "warning",
                    "detail": "Annulation effectuée",
                }
            )
        except Exception:
            steps.append(
                {
                    "action": "Rollback échoué",
                    "status": "error",
                    "detail": f"L'entité reste sous '{final_old_id}'",
                }
            )

        connection.send_result(
            msg["id"],
            {
                "success": False,
                "error": f"Impossible de renommer '{new_entity_id}' en '{old_entity_id}' : {exc}",
                "steps": steps,
            },
        )
        return

    # Save to history
    record = {
        "id": str(uuid.uuid4()),
        "timestamp": time.time(),
        "original_entity_id": old_entity_id,
        "new_device_original_id": new_entity_id,
        "old_renamed_to": final_old_id,  # None if old entity was already gone
    }
    history = _load_history(hass)
    history.insert(0, record)
    _save_history(hass, history)

    connection.send_result(
        msg["id"],
        {
            "success": True,
            "steps": steps,
            "summary": {
                "new_controls_as": old_entity_id,
                "old_renamed_to": final_old_id,
            },
        },
    )


@websocket_api.websocket_command(
    {vol.Required("type"): "entity_swapper/history"}
)
@websocket_api.async_response
async def ws_swap_history(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return swap history."""
    connection.send_result(msg["id"], _load_history(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "entity_swapper/revert",
        vol.Required("swap_id"): str,
    }
)
@websocket_api.async_response
async def ws_swap_revert(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Revert a swap from history."""
    swap_id = msg["swap_id"]
    history = _load_history(hass)
    record = next((r for r in history if r["id"] == swap_id), None)

    if not record:
        connection.send_error(msg["id"], "not_found", "Swap introuvable dans l'historique.")
        return

    registry = er.async_get(hass)
    original_id = record["original_entity_id"]
    old_renamed_to = record.get("old_renamed_to")  # None if old entity was already gone
    steps = []

    # Step 1: current holder of original_id → temp
    current_holder = registry.async_get(original_id)
    if not current_holder:
        connection.send_error(
            msg["id"], "not_found",
            f"L'entité '{original_id}' n'existe plus dans le registre."
        )
        return

    temp_id = _find_available_id(registry, original_id, "revert_temp")
    try:
        registry.async_update_entity(original_id, new_entity_id=temp_id)
        steps.append({"action": f"{original_id}  →  {temp_id}", "status": "success", "detail": "Entité actuelle déplacée temporairement"})
    except Exception as exc:
        connection.send_error(msg["id"], "rename_failed", f"Impossible de déplacer '{original_id}' : {exc}")
        return

    # Step 2: old_renamed_to → original_id (restore old entity, if it was renamed)
    if old_renamed_to:
        old_entry = registry.async_get(old_renamed_to)
        if old_entry:
            try:
                registry.async_update_entity(old_renamed_to, new_entity_id=original_id)
                steps.append({"action": f"{old_renamed_to}  →  {original_id}", "status": "success", "detail": "Ancienne entité restaurée"})
            except Exception as exc:
                # Rollback step 1
                try:
                    registry.async_update_entity(temp_id, new_entity_id=original_id)
                except Exception:
                    pass
                connection.send_error(msg["id"], "rename_failed", f"Impossible de restaurer '{old_renamed_to}' : {exc}")
                return
        else:
            steps.append({"action": f"{old_renamed_to} introuvable", "status": "warning", "detail": "L'ancienne entité n'existe plus, seul le nouveau dispositif est remis à son ID d'origine"})
    else:
        steps.append({"action": "Ancienne entité absente", "status": "info", "detail": "L'ancienne entité n'existait plus lors du swap, rien à restaurer"})

    # Step 3: temp → new_device_original_id (restore new device to its original name)
    new_orig = record["new_device_original_id"]
    target_id = new_orig if not registry.async_get(new_orig) else _find_available_id(registry, new_orig, "restored")
    try:
        registry.async_update_entity(temp_id, new_entity_id=target_id)
        steps.append({"action": f"{temp_id}  →  {target_id}", "status": "success", "detail": "Nouveau dispositif remis à son ID d'origine"})
    except Exception as exc:
        steps.append({"action": f"{temp_id}  →  {target_id}", "status": "warning", "detail": f"Échec : {exc}"})

    # Remove from history
    history = [r for r in history if r["id"] != swap_id]
    _save_history(hass, history)

    connection.send_result(
        msg["id"],
        {"success": True, "steps": steps},
    )

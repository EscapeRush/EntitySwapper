"""Entity Swapper - Swap entity IDs in Home Assistant."""

import logging
import os

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

    # Register websocket command
    websocket_api.async_register_command(hass, ws_swap_entities)

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

    old_entry = registry.async_get(old_entity_id)
    if not old_entry:
        connection.send_error(
            msg["id"],
            "not_found",
            f"L'entité '{old_entity_id}' n'existe pas dans le registre. "
            f"Seules les entités enregistrées peuvent être échangées.",
        )
        return

    new_entry = registry.async_get(new_entity_id)
    if not new_entry:
        connection.send_error(
            msg["id"],
            "not_found",
            f"L'entité '{new_entity_id}' n'existe pas dans le registre. "
            f"Seules les entités enregistrées peuvent être échangées.",
        )
        return

    steps = []

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

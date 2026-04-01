"""Config flow for Entity Swapper."""

from homeassistant import config_entries

from .const import DOMAIN


class EntitySwapperConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Entity Swapper."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        if user_input is not None:
            await self.async_set_unique_id(DOMAIN)
            self._abort_if_unique_id_configured()
            return self.async_create_entry(title="Entity Swapper", data={})
        return self.async_show_form(step_id="user")

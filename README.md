# Entity Swapper

Custom Home Assistant integration to swap entity IDs between two devices.

## Use Case

When a device (smart plug, sensor, etc.) fails and needs to be replaced, all automations and scripts referencing the old entity ID stop working. **Entity Swapper** transfers the entity ID from the old device to the new one in one click — all your automations keep working without any manual editing.

### What it does

1. Renames the old entity to `{entity_id}_old`
2. Gives the new entity the old entity's ID
3. All automations, scripts, and scenes continue working with the new device

## Installation

### HACS (recommended)

1. Open HACS in Home Assistant
2. Click **⋮** → **Custom repositories**
3. Add `https://github.com/vincentcolignon/EntitySwapper` — Category: **Integration**
4. Search for **Entity Swapper** and install it
5. **Restart** Home Assistant
6. Go to **Settings → Devices & Services → + Add Integration → Entity Swapper**

### Manual

1. Copy the `custom_components/entity_swapper` folder into your `config/custom_components/` directory
2. **Restart** Home Assistant
3. Go to **Settings → Devices & Services → + Add Integration → Entity Swapper**

## Usage

1. Click **Entity Swapper** in the sidebar
2. Select the entity to replace (old / broken device) on the left
3. Select the replacement entity (new device) on the right
4. Click **GO**
5. Review the step-by-step report

> **Note:** Both entities must share the same domain (e.g. both `switch.*`, both `light.*`). The old entity will be renamed with an `_old` suffix and can be disabled or removed manually.

## Requirements

- Home Assistant **2024.1** or newer
- Admin access (the panel is admin-only)

## License

MIT

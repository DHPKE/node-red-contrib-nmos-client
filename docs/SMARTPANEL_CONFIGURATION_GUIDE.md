# SmartPanel 1200 Series Configuration Guide

## Overview

This guide provides detailed instructions for configuring and using RIEDEL RSP-1216HL and RSP-1232HL SmartPanels with the NMOS RIEDEL Artist node in Node-RED.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Panel Specifications](#panel-specifications)
3. [Configuration](#configuration)
4. [LED Control](#led-control)
5. [Display Control](#display-control)
6. [Event Handling](#event-handling)
7. [Example Workflows](#example-workflows)
8. [Best Practices](#best-practices)

---

## Quick Start

### 1. Basic Setup

1. **Add RIEDEL Artist Node**
   - Drag `nmos-riedel-artist` node to your flow
   - Double-click to open configuration

2. **Configure Registry**
   - Select or create `nmos-config` node
   - Set NMOS registry URL (e.g., `http://192.168.1.100:8080`)

3. **Set MQTT Broker**
   - Enter MQTT broker URL (e.g., `mqtt://localhost:1883`)
   - Set QoS to 1 for reliable delivery

4. **Select SmartPanel Preset**
   - Choose panel type: `smartpanel`
   - Select SmartPanel Preset: `RSP-1216HL` or `RSP-1232HL`

5. **Deploy and Test**
   - Click Deploy
   - Check status indicator (should be green after registration)

### 2. Import Example Flow

```
Menu → Import → Examples → @DHPKE/node-red-contrib-nmos-client
→ riedel-smartpanel-rsp1216hl-example (or rsp1232hl-example)
```

---

## Panel Specifications

### RSP-1216HL

**Hardware:**
- 16 programmable keys with RGB LEDs
- 8 LeverKey switches (dual-position)
- 4 OLED displays (2 lines × 16 characters each)
- 4 rotary encoders with push buttons

**Key Layout:**
- Keys 1-4: Associated with Display 1, Rotary 1
- Keys 5-8: Associated with Display 2, Rotary 2
- Keys 9-12: Associated with Display 3, Rotary 3
- Keys 13-16: Associated with Display 4, Rotary 4

**Display Positions:**
- Display 1: Top-left
- Display 2: Top-right
- Display 3: Bottom-left
- Display 4: Bottom-right

### RSP-1232HL

**Hardware:**
- 32 programmable keys with RGB LEDs
- 16 LeverKey switches (dual-position)
- 4 OLED displays (2 lines × 16 characters each)
- 4 rotary encoders with push buttons

**Key Layout:**
- Keys 1-8: Associated with Display 1, Rotary 1
- Keys 9-16: Associated with Display 2, Rotary 2
- Keys 17-24: Associated with Display 3, Rotary 3
- Keys 25-32: Associated with Display 4, Rotary 4

**Display Positions:**
- Display 1: Top-left
- Display 2: Top-right
- Display 3: Bottom-left
- Display 4: Bottom-right

---

## Configuration

### Node Configuration

```javascript
{
    // Required
    registry: "nmos-config-node-id",
    mqttBroker: "mqtt://localhost:1883",
    
    // Panel Settings
    deviceLabel: "Production SmartPanel",
    deviceDescription: "RSP-1216HL for camera control",
    panelLabel: "Camera Panel",
    panelType: "smartpanel",
    smartpanelPreset: "RSP-1216HL",  // or "RSP-1232HL"
    
    // Features
    enableKeyControl: true,
    enableAudioRouting: true,
    
    // MQTT Settings
    mqttQos: 1  // 0=at most once, 1=at least once, 2=exactly once
}
```

### Preset Features

Both presets include:
- Complete key mappings
- Display position configurations
- Rotary encoder associations
- Predefined color profiles

**Color Profiles:**
- `idle`: Green at 50% brightness
- `active`: Red at 100% brightness
- `warning`: Amber at 75% brightness
- `off`: LED off at 0% brightness

---

## LED Control

### Basic LED Control

```javascript
// Set individual LED color and brightness
msg.payload = {
    action: "set_led_color",
    keyId: 5,                    // Key number (1-16 or 1-32)
    color: "red",                // red, green, amber, or off
    brightness: 100              // 0-100 (optional, default 100)
};
```

### Using Color Profiles

```javascript
// Apply predefined color profile
msg.payload = {
    action: "apply_color_profile",
    keyId: 5,
    profile: "active"            // idle, active, warning, or off
};
```

### Multiple LED Control

```javascript
// Function node to control multiple LEDs
const messages = [];

// Set keys 1-8 to green
for (let i = 1; i <= 8; i++) {
    messages.push({
        payload: {
            action: "set_led_color",
            keyId: i,
            color: "green",
            brightness: 75
        }
    });
}

return [messages];
```

### LED States for Production

```javascript
// Production state indicators
const states = {
    ready: { color: "green", brightness: 50 },      // Idle/ready
    live: { color: "red", brightness: 100 },        // Live/active
    preview: { color: "amber", brightness: 75 },    // Preview/warning
    offline: { color: "off", brightness: 0 }        // Disabled/offline
};

msg.payload = {
    action: "set_led_color",
    keyId: 1,
    color: states.live.color,
    brightness: states.live.brightness
};
```

---

## Display Control

### Write Multi-line Text

```javascript
// Write to entire display (2 lines)
msg.payload = {
    action: "send_display_text",
    displayId: 1,                // 1-4
    text: "Camera 1\nReady",     // Line 1\nLine 2
    brightness: 100,             // optional
    scroll: false                // optional
};

// Or use array format
msg.payload = {
    action: "send_display_text",
    displayId: 1,
    text: ["Camera 1", "Ready"]
};
```

### Update Single Line

```javascript
// Update specific line
msg.payload = {
    action: "send_display_line",
    displayId: 1,
    lineNumber: 2,               // 1 or 2
    text: "Recording",           // max 16 chars
    brightness: 100              // optional
};
```

### Display Templates

```javascript
// Create display templates for common statuses
const displayTemplates = {
    camera1: {
        idle: ["Camera 1", "Idle"],
        preview: ["Camera 1", "Preview"],
        live: ["Camera 1", "*** LIVE ***"]
    },
    director: {
        standby: ["Director", "Standby"],
        recording: ["Director", "Recording"],
        stopped: ["Director", "Stopped"]
    }
};

// Use template
msg.payload = {
    action: "send_display_text",
    displayId: 1,
    text: displayTemplates.camera1.live.join('\n')
};
```

### Dynamic Display Updates

```javascript
// Function node for dynamic status
const status = flow.get("camera1_status") || "idle";
const timestamp = new Date().toTimeString().substr(0,8);

msg.payload = {
    action: "send_display_text",
    displayId: 1,
    text: `Camera 1\n${status} ${timestamp.substr(0,8)}`  // Truncate to fit
};

return msg;
```

---

## Event Handling

### Button Events

**Incoming Events:**
```javascript
// msg.artist.commands contains parsed events
{
    type: "button",
    button: 5,           // Button number
    action: "press",     // "press" or "release"
    pressed: true,       // boolean
    timestamp: "..."
}
```

**Handle Button Press:**
```javascript
// Function node
if (msg.artist && msg.artist.commands) {
    for (const cmd of msg.artist.commands) {
        if (cmd.type === "button" && cmd.pressed) {
            node.warn(`Button ${cmd.button} pressed`);
            
            // Trigger action based on button
            if (cmd.button === 1) {
                msg.payload = { action: "start_recording" };
                return msg;
            }
        }
    }
}
return null;
```

### LeverKey Events

**Incoming Events:**
```javascript
{
    type: "leverkey",
    leverkey: 3,         // LeverKey number
    direction: "up",     // "up" or "down"
    state: true,         // boolean
    timestamp: "..."
}
```

**Handle LeverKey:**
```javascript
// Function node
if (msg.artist && msg.artist.commands) {
    for (const cmd of msg.artist.commands) {
        if (cmd.type === "leverkey") {
            const state = cmd.direction === "up" ? "UP" : "DOWN";
            node.warn(`LeverKey ${cmd.leverkey} ${state}`);
            
            // Update LED based on position
            const color = cmd.direction === "up" ? "green" : "red";
            return {
                payload: {
                    action: "set_led_color",
                    keyId: cmd.leverkey,
                    color: color
                }
            };
        }
    }
}
```

### Rotary Encoder Events

**Incoming Events:**
```javascript
{
    type: "rotary",
    rotary: 1,           // Rotary number (1-4)
    action: "left",      // "left", "right", or "push"
    value: 1,            // increment/decrement or push state
    timestamp: "..."
}
```

**Handle Rotary:**
```javascript
// Function node - adjust brightness with rotary
let brightness = flow.get("led_brightness") || 50;

if (msg.artist && msg.artist.commands) {
    for (const cmd of msg.artist.commands) {
        if (cmd.type === "rotary" && cmd.rotary === 1) {
            if (cmd.action === "left") {
                brightness = Math.max(0, brightness - 5);
            } else if (cmd.action === "right") {
                brightness = Math.min(100, brightness + 5);
            } else if (cmd.action === "push") {
                brightness = 100;  // Reset to full
            }
            
            flow.set("led_brightness", brightness);
            
            return {
                payload: {
                    action: "set_led_color",
                    keyId: 1,
                    color: "green",
                    brightness: brightness
                }
            };
        }
    }
}
```

---

## Example Workflows

### Camera Control Panel (RSP-1216HL)

```javascript
// Initialize panel on startup
const init = [
    // Set all LEDs to idle
    ...Array.from({length: 16}, (_, i) => ({
        payload: { action: "apply_color_profile", keyId: i+1, profile: "idle" }
    })),
    // Set display labels
    { payload: { action: "send_display_text", displayId: 1, text: "Camera 1\nIdle" }},
    { payload: { action: "send_display_text", displayId: 2, text: "Camera 2\nIdle" }},
    { payload: { action: "send_display_text", displayId: 3, text: "Camera 3\nIdle" }},
    { payload: { action: "send_display_text", displayId: 4, text: "Camera 4\nIdle" }}
];

return [init];
```

### Production Workflow (RSP-1232HL)

```javascript
// Function node - Production state machine
const state = msg.payload.production_state;  // "standby", "preview", "live"

const messages = [];

switch (state) {
    case "standby":
        // All cameras idle (green)
        for (let i = 1; i <= 32; i++) {
            messages.push({ payload: { action: "apply_color_profile", keyId: i, profile: "idle" }});
        }
        messages.push({ payload: { action: "send_display_text", displayId: 1, text: "Production\nStandby" }});
        break;
        
    case "preview":
        // Cameras 1-8 preview (amber)
        for (let i = 1; i <= 8; i++) {
            messages.push({ payload: { action: "apply_color_profile", keyId: i, profile: "warning" }});
        }
        messages.push({ payload: { action: "send_display_text", displayId: 1, text: "Production\nPreview" }});
        break;
        
    case "live":
        // Camera 1 live (red), others standby
        messages.push({ payload: { action: "apply_color_profile", keyId: 1, profile: "active" }});
        for (let i = 2; i <= 8; i++) {
            messages.push({ payload: { action: "apply_color_profile", keyId: i, profile: "idle" }});
        }
        messages.push({ payload: { action: "send_display_text", displayId: 1, text: "Production\n*** LIVE ***" }});
        break;
}

return [messages];
```

---

## Best Practices

### 1. LED Usage

- **Use color profiles** for consistent state representation
- **Avoid rapid LED changes** (< 100ms) to prevent flickering
- **Set appropriate brightness** based on environment (studio vs control room)
- **Use meaningful colors**: green=ready, red=active, amber=warning, off=disabled

### 2. Display Text

- **Keep text concise** - maximum 16 characters per line
- **Use clear abbreviations** when necessary
- **Update displays only when needed** to reduce MQTT traffic
- **Consider readability** - avoid all caps except for alerts

### 3. Event Handling

- **Filter events** by type to reduce processing overhead
- **Debounce button presses** if necessary
- **Use leverkeys** for binary states (on/off, up/down)
- **Use rotary encoders** for continuous adjustments (volume, brightness)

### 4. Production Workflows

- **Initialize panel state** on flow startup
- **Maintain state** in flow context variables
- **Implement error handling** for invalid commands
- **Log critical events** for troubleshooting
- **Test thoroughly** before production use

### 5. Performance

- **Batch LED updates** when setting multiple LEDs
- **Use appropriate MQTT QoS** (1 recommended for control)
- **Monitor heartbeat status** in production
- **Implement reconnection logic** for MQTT failures

---

## Troubleshooting

For detailed troubleshooting steps, see [RIEDEL_TROUBLESHOOTING.md](RIEDEL_TROUBLESHOOTING.md).

Common issues:
- Panel not registering → Check registry URL and connectivity
- LEDs not changing → Verify SmartPanel preset selected
- Displays not updating → Check text length (max 16 chars/line)
- Events not parsing → Verify MQTT broker connection

---

## Additional Resources

- **Example Flows:** `examples/riedel-smartpanel-rsp*.json`
- **Troubleshooting Guide:** `docs/RIEDEL_TROUBLESHOOTING.md`
- **IS-07 Specification:** https://specs.amwa.tv/is-07/
- **RIEDEL Product Info:** https://www.riedel.net/en/products-solutions/intercom/smartpanels/1200-series

---

Last updated: 2025-11-20

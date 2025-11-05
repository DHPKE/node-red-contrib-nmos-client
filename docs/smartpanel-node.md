# NMOS Smartpanel Node - Complete Documentation

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Installation & Setup](#installation--setup)
5. [Configuration Guide](#configuration-guide)
6. [IS-07 Compliance](#is-07-compliance)
7. [Command Types Reference](#command-types-reference)
8. [Input Actions API](#input-actions-api)
9. [Output Message Structure](#output-message-structure)
10. [Button Display Writing](#button-display-writing)
11. [Riedel Smartpanel Integration](#riedel-smartpanel-integration)
12. [Example Flows](#example-flows)
13. [Troubleshooting](#troubleshooting)
14. [MQTT Testing](#mqtt-testing)
15. [Best Practices](#best-practices)
16. [Advanced Topics](#advanced-topics)

---

## Overview

The **nmos-smartpanel** node is a complete rewrite of the NMOS IS-07 endpoint implementation, purpose-built for professional integration with Riedel Smartpanel control surfaces. This node provides full bidirectional communication: receiving commands from Smartpanel hardware and sending button display text updates.

### Key Capabilities

- ✅ **Full AMWA IS-07 Compliance** - Proper grain structure, TAI timestamps, MQTT topics
- ✅ **IS-04 Device Registration** - Automatic registration with 5-second heartbeat
- ✅ **Comprehensive Command Parsing** - Buttons, rotary encoders, GPIO, tally, faders
- ✅ **Button Display Writing** - Send text and colors to Smartpanel displays
- ✅ **Command History** - Track last 100 commands for monitoring
- ✅ **Multi-Source Support** - Receive and track events from multiple sources
- ✅ **Production Ready** - Robust error handling and state management

---

## Features

### IS-07 Event & Tally Specification

The node implements the AMWA NMOS IS-07 specification for event-based control:

- **Grain Structure**: Proper IS-07 grain messages with metadata
- **TAI Timestamps**: International Atomic Time format (seconds:nanoseconds)
- **MQTT Transport**: Subscribe and publish via MQTT broker
- **Event Types**: Support for boolean, string, number, enum, and object events
- **Topic Format**: `x-nmos/events/1.0/{source_id}/{event_type}`

### IS-04 Registration

Automatic registration as an NMOS device:

- **Node Resource**: Represents the compute host
- **Device Resource**: The Smartpanel interface device
- **Source Resource**: For status feedback (button displays)
- **Receiver Resource**: For command reception
- **Heartbeat**: Maintains registration every 5 seconds
- **Auto Re-registration**: Recovers from registry connection loss

### Smartpanel Command Parsing

Automatically interprets Riedel Smartpanel command patterns:

| Command Type | Path Pattern | Example |
|--------------|--------------|---------|
| **Buttons** | `button/{n}`, `key/{n}`, `switch/{n}` | `button/1` |
| **Rotary Encoders** | `rotary/{n}`, `encoder/{n}`, `knob/{n}` | `rotary/1` |
| **GPIO Inputs** | `gpio/input/{n}`, `gpi/{n}` | `gpio/input/1` |
| **Tally** | `tally/red`, `tally/green`, `tally/amber` | `tally/red` |
| **Faders** | `fader/{n}`, `level/{n}`, `gain/{n}` | `fader/1` |

### Button Display Writing

Send text and color updates to Smartpanel button displays:

- Single or multiple button updates
- Text content (up to display limits)
- Color selection (red, green, amber, white)
- Proper IS-07 grain structure
- State tracking

---

## Architecture

```
┌─────────────────────────┐
│   NMOS IS-04 Registry   │
│   (Discovery & Health)  │
└────────────┬────────────┘
             │ Registration
             │ Heartbeat (5s)
             │
┌────────────▼────────────┐         MQTT/IS-07          ┌──────────────────┐
│                         │◄────────────────────────────│ Riedel           │
│   nmos-smartpanel       │     Commands (Subscribe)    │ Smartpanel       │
│   Node-RED Node         │                             │ Hardware         │
│                         │─────────────────────────────►│                  │
└────────────┬────────────┘     Button Text (Publish)   └──────────────────┘
             │
             │ Output Messages
             │
┌────────────▼────────────┐
│   Node-RED Flow         │
│   (Process Commands)    │
└─────────────────────────┘
```

### Data Flow

1. **Initialization**
   - Connect to MQTT broker
   - Register with IS-04 registry
   - Subscribe to command topics
   - Start heartbeat timer

2. **Command Reception**
   - Receive IS-07 grain via MQTT
   - Validate grain structure
   - Parse Smartpanel commands
   - Add to command history
   - Output structured message

3. **Button Display Updates**
   - Receive input message action
   - Build IS-07 grain for button text
   - Publish to MQTT topic
   - Update button state tracking

---

## Installation & Setup

### Prerequisites

1. **Node-RED** installed and running
2. **NMOS IS-04 Registry** accessible on network
3. **MQTT Broker** (Mosquitto, HiveMQ, etc.)
4. **Riedel Smartpanel** (optional, for hardware testing)

### Installation

#### Via Node-RED Palette Manager

1. Open Node-RED editor
2. Menu → Manage palette
3. Install tab → Search for `node-red-contrib-nmos-client`
4. Click Install

#### Via npm

```bash
cd ~/.node-red
npm install node-red-contrib-nmos-client
```

### Quick Start

1. **Add NMOS Config Node**
   - Add and configure `nmos-config` node
   - Set registry URL (e.g., `http://192.168.1.100:8080`)
   - Set API version (v1.3 recommended)

2. **Add Smartpanel Node**
   - Drag `nmos-smartpanel` from palette
   - Configure MQTT broker URL
   - Set device label
   - Deploy

3. **Verify Connection**
   - Check node status: should show green dot
   - Check registry for registered device
   - Send test MQTT message

---

## Configuration Guide

### Basic Settings

#### Name
- **Field**: Name
- **Type**: String (optional)
- **Description**: Display name for the node in Node-RED
- **Default**: Uses device label
- **Example**: "Studio A Smartpanel"

#### Registry
- **Field**: Registry
- **Type**: nmos-config node reference
- **Required**: Yes
- **Description**: NMOS IS-04 registry configuration
- **Example**: Select configured nmos-config node

### MQTT Configuration

#### MQTT Broker
- **Field**: MQTT Broker
- **Type**: URL string
- **Required**: Yes
- **Format**: `protocol://host:port`
- **Supported Protocols**:
  - `mqtt://` - Standard MQTT
  - `mqtts://` - MQTT over TLS/SSL
  - `ws://` - MQTT over WebSocket
  - `wss://` - MQTT over secure WebSocket
- **Examples**:
  - `mqtt://192.168.1.50:1883`
  - `mqtts://broker.example.com:8883`
  - `ws://localhost:9001`

#### QoS (Quality of Service)
- **Field**: QoS
- **Type**: Integer (0, 1, or 2)
- **Default**: 0
- **Description**: MQTT quality of service level
- **Options**:
  - **0** - At most once (fire and forget)
  - **1** - At least once (acknowledged delivery)
  - **2** - Exactly once (assured delivery)
- **Recommendation**: Use 0 for low latency, 1 for reliability

#### Subscription Filter
- **Field**: Subscription Filter
- **Type**: MQTT topic pattern
- **Default**: `x-nmos/events/1.0/+/+`
- **Description**: MQTT topic pattern for subscribing to commands
- **Wildcards**:
  - `+` - Single level wildcard
  - `#` - Multi-level wildcard
- **Examples**:
  - `x-nmos/events/1.0/+/+` - All sources, all event types
  - `x-nmos/events/1.0/abc123/+` - Specific source, all types
  - `x-nmos/events/1.0/+/boolean` - All sources, boolean events only

### Device Configuration

#### Device Label
- **Field**: Device Label
- **Type**: String
- **Default**: "Riedel Smartpanel"
- **Description**: Human-readable device name shown in NMOS registry
- **Example**: "Camera 1 Control Panel"

#### Device Description
- **Field**: Description
- **Type**: String
- **Default**: "NMOS IS-07 Smartpanel Interface"
- **Description**: Detailed description of the device purpose
- **Example**: "Production switcher control panel for Studio A"

### Features

#### Enable Button Display Writing
- **Field**: Enable Button Display
- **Type**: Boolean checkbox
- **Default**: Enabled (checked)
- **Description**: When enabled, allows sending text to Smartpanel button displays
- **Impact**: Creates IS-04 Source resource for publishing

#### Auto-parse Smartpanel Commands
- **Field**: Auto-parse Commands
- **Type**: Boolean checkbox
- **Default**: Enabled (checked)
- **Description**: Automatically interpret and parse Smartpanel command patterns
- **Impact**: Adds `smartpanel.commands` array to output messages

### Resource IDs

These UUIDs uniquely identify the device in the NMOS registry:

#### Node ID
- **Field**: Node ID
- **Type**: UUID (auto-generated)
- **Description**: Identifies the compute node (host)
- **Registration**: IS-04 Node resource

#### Device ID
- **Field**: Device ID
- **Type**: UUID (auto-generated)
- **Description**: Identifies the Smartpanel device
- **Registration**: IS-04 Device resource

#### Source ID
- **Field**: Source ID
- **Type**: UUID (auto-generated)
- **Description**: Identifies the status/feedback source
- **Registration**: IS-04 Source resource (if button display enabled)

#### Receiver ID
- **Field**: Receiver ID
- **Type**: UUID (auto-generated)
- **Description**: Identifies the command receiver
- **Registration**: IS-04 Receiver resource

#### Regenerate IDs Button
- **Action**: Regenerates all UUIDs
- **Warning**: Only use this to register as a completely new device
- **Impact**: Breaks existing connections and subscriptions

---

## IS-07 Compliance

### Grain Structure

The node fully implements the IS-07 grain specification:

```json
{
  "grain_type": "event",
  "source_id": "uuid-of-source",
  "flow_id": "uuid-of-flow",
  "origin_timestamp": "1731679200:500000000",
  "sync_timestamp": "1731679200:500000000",
  "creation_timestamp": "1731679200:500000000",
  "rate": {
    "numerator": 0,
    "denominator": 1
  },
  "duration": {
    "numerator": 0,
    "denominator": 1
  },
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "x-nmos/events/1.0/{source_id}/{event_type}",
    "data": [
      {
        "path": "property/path",
        "pre": "previous_value",
        "post": "new_value"
      }
    ]
  }
}
```

### TAI Timestamps

The node uses TAI (International Atomic Time) format as required by IS-07:

- **Format**: `seconds:nanoseconds`
- **Example**: `1731679200:500000000`
- **Offset**: TAI = UTC + 37 seconds (as of 2017)
- **Reference**: [IETF Leap Seconds List](https://www.ietf.org/timezones/data/leap-seconds.list)

### MQTT Topics

All IS-07 events use the standard topic format:

```
x-nmos/events/1.0/{source_id}/{event_type}
```

**Event Types**:
- `boolean` - True/false states
- `string` - Text values
- `number` - Numeric values
- `enum` - Enumerated choices
- `object` - Complex objects

### Grain Validation

The node validates all received grains:

```javascript
// Required fields
✓ grain_type
✓ source_id
✓ flow_id
✓ origin_timestamp
✓ data (array)
```

Invalid grains are logged and discarded.

---

## Command Types Reference

### Button Commands

**Recognized Patterns**:
- `button/{index}` - Button number (1-based)
- `key/{index}` - Key number
- `switch/{index}` - Switch number

**Example Grain Data**:
```json
{
  "path": "button/1",
  "pre": false,
  "post": true
}
```

**Parsed Output**:
```json
{
  "type": "button",
  "button": 1,
  "index": 1,
  "pressed": true,
  "timestamp": "1731679200:500000000",
  "raw_path": "button/1",
  "raw_value": true,
  "pre_value": false
}
```

**Use Cases**:
- Trigger camera selection
- Start/stop recording
- Enable/disable effects
- Switch scenes

### Rotary Encoder Commands

**Recognized Patterns**:
- `rotary/{index}` - Rotary encoder
- `encoder/{index}` - Encoder
- `knob/{index}` - Knob

**Example Grain Data**:
```json
{
  "path": "rotary/1",
  "pre": 0.50,
  "post": 0.55
}
```

**Parsed Output**:
```json
{
  "type": "rotary",
  "encoder": 1,
  "index": 1,
  "value": 0.55,
  "delta": 0.05,
  "direction": "clockwise",
  "position": 0.55,
  "timestamp": "1731679200:500000000",
  "raw_path": "rotary/1",
  "raw_value": 0.55,
  "pre_value": 0.50
}
```

**Fields**:
- `value` - Current value (typically 0.0 to 1.0)
- `delta` - Change from previous value
- `direction` - "clockwise", "counterclockwise", or "none"
- `position` - Normalized position (0.0 to 1.0)

**Use Cases**:
- Adjust audio levels
- Pan cameras
- Control brightness
- Fine-tune parameters

### GPIO/GPI Commands

**Recognized Patterns**:
- `gpio/input/{index}` - GPIO input port
- `gpi/{index}` - GPI port

**Example Grain Data**:
```json
{
  "path": "gpio/input/1",
  "pre": false,
  "post": true
}
```

**Parsed Output**:
```json
{
  "type": "gpio",
  "gpio": 1,
  "index": 1,
  "state": true,
  "timestamp": "1731679200:500000000",
  "raw_path": "gpio/input/1",
  "raw_value": true,
  "pre_value": false
}
```

**Use Cases**:
- External trigger inputs
- Contact closures
- Door/sensor monitoring
- Emergency stop signals

### Tally Commands

**Recognized Patterns**:
- `tally/red` - Program tally (on-air)
- `tally/green` - Preview tally
- `tally/amber` - Warning/standby
- `tally/yellow` - Alternative warning
- `tally/program` - Program state
- `tally/preview` - Preview state
- `tally/white` - Generic indicator

**Example Grain Data**:
```json
{
  "path": "tally/red",
  "pre": false,
  "post": true
}
```

**Parsed Output**:
```json
{
  "type": "tally",
  "color": "red",
  "state": true,
  "timestamp": "1731679200:500000000",
  "raw_path": "tally/red",
  "raw_value": true,
  "pre_value": false
}
```

**Use Cases**:
- Camera tally lights
- Recording indicators
- Warning signals
- Production cues

### Fader Commands

**Recognized Patterns**:
- `fader/{index}` - Fader/slider
- `level/{index}` - Level control
- `gain/{index}` - Gain control

**Example Grain Data**:
```json
{
  "path": "fader/1",
  "pre": 0.60,
  "post": 0.75
}
```

**Parsed Output**:
```json
{
  "type": "fader",
  "fader": 1,
  "index": 1,
  "value": 0.75,
  "normalized": 0.75,
  "timestamp": "1731679200:500000000",
  "raw_path": "fader/1",
  "raw_value": 0.75,
  "pre_value": 0.60
}
```

**Fields**:
- `value` - Raw fader value
- `normalized` - Clamped to 0.0-1.0 range

**Use Cases**:
- Audio mixing
- Video transition speeds
- Opacity controls
- Generic parameter adjustment

### Generic Property Commands

Any path not matching the above patterns is treated as a generic property:

**Parsed Output**:
```json
{
  "type": "property",
  "path": "custom/path/here",
  "value": "some_value",
  "timestamp": "1731679200:500000000",
  "raw_path": "custom/path/here",
  "raw_value": "some_value",
  "pre_value": "old_value"
}
```

---

## Input Actions API

The node accepts input messages with various actions:

### get_state

Returns current node state and configuration.

**Input**:
```javascript
msg.action = "get_state";
```

**Output**:
```json
{
  "node_id": "uuid",
  "device_id": "uuid",
  "source_id": "uuid",
  "receiver_id": "uuid",
  "mqtt_connected": true,
  "registered": true,
  "button_display_enabled": true,
  "auto_parse_enabled": true,
  "command_history_size": 42,
  "known_sources": ["source-uuid-1", "source-uuid-2"],
  "button_states": {
    "1": "CAM 1",
    "2": "CAM 2",
    "3": "REC"
  }
}
```

### get_command_history

Returns recent command history (last 100 commands).

**Input**:
```javascript
msg.action = "get_command_history";
```

**Output**:
```json
{
  "commands": [
    {
      "type": "button",
      "button": 1,
      "pressed": true,
      "received_at": "2024-11-05T12:30:00.000Z",
      "topic": "x-nmos/events/1.0/source-id/boolean",
      "source_id": "source-uuid"
    }
  ],
  "total": 42
}
```

### clear_history

Clears the command history.

**Input**:
```javascript
msg.action = "clear_history";
```

**Output**:
```json
{
  "status": "history cleared"
}
```

### set_button_text

Writes text to a single button display.

**Input**:
```javascript
msg = {
  action: "set_button_text",
  button: 1,
  text: "REC",
  color: "red"  // optional: red, green, amber, white
};
```

**Result**: Publishes IS-07 grain to MQTT with button text update.

### set_multiple_buttons

Updates multiple button displays in one operation.

**Input**:
```javascript
msg = {
  action: "set_multiple_buttons",
  buttons: [
    { button: 1, text: "CAM 1", color: "green" },
    { button: 2, text: "CAM 2", color: "white" },
    { button: 3, text: "REC", color: "red" }
  ]
};
```

**Result**: Publishes single IS-07 grain with all button updates.

### send_status

Sends a custom IS-07 event grain.

**Input**:
```javascript
msg = {
  action: "send_status",
  grain: {
    // Full IS-07 grain structure
    grain_type: "event",
    source_id: node.sourceId,
    // ... etc
  }
};
```

**Result**: Publishes the custom grain to MQTT.

---

## Output Message Structure

Every received IS-07 event generates an output message:

```javascript
{
  // MQTT topic where event was received
  "topic": "x-nmos/events/1.0/source-uuid/boolean",
  
  // Full IS-07 grain (unmodified)
  "payload": {
    "grain_type": "event",
    "source_id": "source-uuid",
    "flow_id": "flow-uuid",
    "origin_timestamp": "1731679200:500000000",
    "sync_timestamp": "1731679200:500000000",
    "creation_timestamp": "1731679200:500000000",
    "rate": { "numerator": 0, "denominator": 1 },
    "duration": { "numerator": 0, "denominator": 1 },
    "grain": {
      "type": "urn:x-nmos:format:data.event",
      "topic": "x-nmos/events/1.0/source-uuid/boolean",
      "data": [
        {
          "path": "button/1",
          "pre": false,
          "post": true
        }
      ]
    }
  },
  
  // Parsed Smartpanel commands (if auto-parse enabled)
  "smartpanel": {
    "commands": [
      {
        "type": "button",
        "button": 1,
        "pressed": true,
        "index": 1,
        "timestamp": "1731679200:500000000",
        "raw_path": "button/1",
        "raw_value": true,
        "pre_value": false
      }
    ]
  },
  
  // Source ID that sent this event
  "source_id": "source-uuid",
  
  // Origin timestamp from grain (for tracking)
  "grain_timestamp": "1731679200:500000000"
}
```

### Usage Example

```javascript
// Access parsed button command
const button = msg.smartpanel.commands[0];
if (button.type === 'button' && button.pressed) {
    node.log(`Button ${button.button} pressed!`);
}

// Access raw grain
const grain = msg.payload;
node.log(`Event from source: ${grain.source_id}`);

// Access individual data items
for (const item of grain.grain.data) {
    node.log(`${item.path}: ${item.pre} → ${item.post}`);
}
```

---

## Button Display Writing

### Overview

The Smartpanel node can write text and colors to Riedel Smartpanel button displays. This enables dynamic button labeling based on production state.

### Single Button Update

```javascript
// In a function node or inject
msg = {
  action: "set_button_text",
  button: 1,        // Button index (1-based)
  text: "REC",      // Display text
  color: "red"      // Optional color
};
return msg;
```

**Colors**: `red`, `green`, `amber`, `white`

### Multiple Button Update

```javascript
msg = {
  action: "set_multiple_buttons",
  buttons: [
    { button: 1, text: "CAM 1", color: "green" },
    { button: 2, text: "CAM 2", color: "white" },
    { button: 3, text: "CAM 3", color: "white" },
    { button: 4, text: "REC", color: "red" },
    { button: 5, text: "STOP", color: "amber" }
  ]
};
return msg;
```

### Generated IS-07 Grain

The node generates proper IS-07 grains for button updates:

```json
{
  "grain_type": "event",
  "source_id": "source-uuid",
  "flow_id": "source-uuid",
  "origin_timestamp": "1731679200:500000000",
  "sync_timestamp": "1731679200:500000000",
  "creation_timestamp": "1731679200:500000000",
  "rate": { "numerator": 0, "denominator": 1 },
  "duration": { "numerator": 0, "denominator": 1 },
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "x-nmos/events/1.0/source-uuid/string",
    "data": [
      {
        "path": "display/button/1/text",
        "pre": "",
        "post": "REC"
      },
      {
        "path": "display/button/1/color",
        "pre": null,
        "post": "red"
      }
    ]
  }
}
```

### Button State Tracking

The node maintains button display states:

```javascript
// Get current button states
msg.action = "get_state";
// Returns: { button_states: { "1": "REC", "2": "CAM 1", ... } }
```

---

## Riedel Smartpanel Integration

### Hardware Setup

1. **Network Configuration**
   - Connect Smartpanel to network
   - Configure IP address
   - Ensure network connectivity to MQTT broker

2. **MQTT Configuration**
   - Configure Smartpanel MQTT client
   - Set broker address and port
   - Configure topic publishing patterns

3. **IS-07 Configuration**
   - Enable IS-07 event publishing
   - Set source ID (UUID)
   - Configure event paths for controls

### Smartpanel Configuration Example

**Button Configuration**:
```
Button 1:
  Path: button/1
  Event Type: boolean
  True on press, False on release
```

**Rotary Encoder Configuration**:
```
Encoder 1:
  Path: rotary/1
  Event Type: number
  Range: 0.0 to 1.0
  Send on change
```

**GPIO Configuration**:
```
GPI 1:
  Path: gpio/input/1
  Event Type: boolean
  True = closed, False = open
```

### Typical Smartpanel Layouts

#### **Camera Control Panel**
```
┌─────┬─────┬─────┬─────┐
│CAM 1│CAM 2│CAM 3│CAM 4│  Buttons 1-4: Camera select
├─────┼─────┼─────┼─────┤
│ REC │STOP │PREV │PGM  │  Buttons 5-8: Recording/switching
├─────┼─────┼─────┼─────┤
│ PTZ │IRIS │FOCUS│ZOOM │  Buttons 9-12: Camera control
└─────┴─────┴─────┴─────┘
      [ROTARY 1]           Encoder: Audio level
```

#### **Audio Mixing Panel**
```
┌─────┬─────┬─────┬─────┐
│MIC 1│MIC 2│MIC 3│MIC 4│  Buttons: Mic mute
├─────┴─────┴─────┴─────┤
│  [FADER 1] [FADER 2]  │  Faders: Levels
│  [FADER 3] [FADER 4]  │
└───────────────────────┘
```

### Testing Smartpanel Integration

#### 1. Verify MQTT Connection
```bash
# Subscribe to all Smartpanel events
mosquitto_sub -h localhost -t "x-nmos/events/1.0/+/+" -v
```

#### 2. Send Test Button Command
```bash
mosquitto_pub -h localhost \
  -t "x-nmos/events/1.0/smartpanel-source-id/boolean" \
  -m '{
    "grain_type": "event",
    "source_id": "smartpanel-source-id",
    "flow_id": "smartpanel-flow-id",
    "origin_timestamp": "1731679200:0",
    "sync_timestamp": "1731679200:0",
    "creation_timestamp": "1731679200:0",
    "rate": {"numerator": 0, "denominator": 1},
    "duration": {"numerator": 0, "denominator": 1},
    "grain": {
      "type": "urn:x-nmos:format:data.event",
      "topic": "x-nmos/events/1.0/smartpanel-source-id/boolean",
      "data": [
        {"path": "button/1", "pre": false, "post": true}
      ]
    }
  }'
```

#### 3. Check Node-RED Output
- Connect debug node to Smartpanel node output
- Press button on physical panel
- Verify parsed command in debug panel

---

## Example Flows

### Example 1: Basic Button Handler

```javascript
[
  {
    "id": "smartpanel1",
    "type": "nmos-smartpanel",
    "name": "Control Panel",
    "registry": "registry-config-id",
    "mqttBroker": "mqtt://localhost:1883"
  },
  {
    "id": "button-handler",
    "type": "function",
    "func": "// Handle button presses\nif (msg.smartpanel && msg.smartpanel.commands) {\n    for (const cmd of msg.smartpanel.commands) {\n        if (cmd.type === 'button' && cmd.pressed) {\n            switch (cmd.button) {\n                case 1:\n                    msg.payload = { camera: 1, action: 'select' };\n                    return msg;\n                case 2:\n                    msg.payload = { camera: 2, action: 'select' };\n                    return msg;\n                case 3:\n                    msg.payload = { action: 'record', state: 'start' };\n                    return msg;\n            }\n        }\n    }\n}\nreturn null;"
  }
]
```

### Example 2: Rotary Encoder Audio Control

```javascript
[
  {
    "id": "smartpanel1",
    "type": "nmos-smartpanel",
    "name": "Mixer Panel"
  },
  {
    "id": "encoder-handler",
    "type": "function",
    "func": "// Handle rotary encoder for audio level\nif (msg.smartpanel && msg.smartpanel.commands) {\n    for (const cmd of msg.smartpanel.commands) {\n        if (cmd.type === 'rotary' && cmd.encoder === 1) {\n            // Convert 0-1 range to dB\n            const db = (cmd.position * 90) - 60; // -60dB to +30dB\n            msg.payload = {\n                channel: 1,\n                level_db: db,\n                level_normalized: cmd.position\n            };\n            return msg;\n        }\n    }\n}\nreturn null;"
  }
]
```

### Example 3: Dynamic Button Labels

```javascript
[
  {
    "id": "camera-selector",
    "type": "function",
    "func": "// Update button labels based on camera availability\nconst cameras = [\n    { id: 1, name: 'CAM 1', online: true },\n    { id: 2, name: 'CAM 2', online: true },\n    { id: 3, name: 'CAM 3', online: false },\n    { id: 4, name: 'CAM 4', online: true }\n];\n\nmsg = {\n    action: 'set_multiple_buttons',\n    buttons: cameras.map(cam => ({\n        button: cam.id,\n        text: cam.name,\n        color: cam.online ? 'green' : 'amber'\n    }))\n};\n\nreturn msg;"
  },
  {
    "id": "smartpanel1",
    "type": "nmos-smartpanel",
    "name": "Panel"
  }
]
```

### Example 4: Tally Light Feedback

```javascript
[
  {
    "id": "smartpanel1",
    "type": "nmos-smartpanel",
    "name": "Tally Receiver"
  },
  {
    "id": "tally-handler",
    "type": "function",
    "func": "// Process tally commands\nif (msg.smartpanel && msg.smartpanel.commands) {\n    for (const cmd of msg.smartpanel.commands) {\n        if (cmd.type === 'tally') {\n            msg.payload = {\n                tally: cmd.color,\n                state: cmd.state,\n                camera: global.get('selectedCamera') || 1\n            };\n            return msg;\n        }\n    }\n}\nreturn null;"
  }
]
```

---

## Troubleshooting

### Node Status Indicators

| Status | Meaning | Action |
|--------|---------|--------|
| 🔴 Red ring | Configuration error or disconnected | Check registry and MQTT settings |
| 🟡 Yellow dot | MQTT connected, registration pending | Wait for registry connection |
| 🟢 Green dot | Fully operational | Normal operation |
| 🔵 Blue ring | Processing message | Temporary, returns to green |

### Common Issues

#### 1. Node Shows Red Ring

**Problem**: Configuration error

**Solutions**:
- Verify NMOS registry configuration exists
- Check registry URL is accessible
- Verify MQTT broker URL format
- Check network connectivity

#### 2. Node Shows Yellow Dot

**Problem**: MQTT connected but registry registration failed

**Solutions**:
- Check registry is running and accessible
- Verify API version compatibility
- Check registry logs for errors
- Try regenerating resource IDs

#### 3. No Commands Received

**Problem**: Messages not reaching node

**Solutions**:
- Verify MQTT subscription filter matches published topics
- Check Smartpanel is publishing to correct broker
- Use `mosquitto_sub` to verify MQTT messages
- Check QoS settings match publisher

#### 4. Button Text Not Appearing

**Problem**: Button display updates not working

**Solutions**:
- Verify "Enable Button Display" is checked
- Check MQTT connection is active
- Verify Smartpanel subscribes to button display topics
- Check button index is correct (1-based)

#### 5. Commands Not Parsing

**Problem**: `msg.smartpanel.commands` is empty

**Solutions**:
- Verify "Auto-parse Commands" is enabled
- Check grain structure is valid IS-07 format
- Verify path patterns match expected formats
- Check grain `data` array contains items

### Debug Techniques

#### 1. Enable Debug Logging

Add debug nodes to monitor:
- Node output (parsed commands)
- Raw MQTT messages
- Node status changes

#### 2. Check MQTT Broker

```bash
# Monitor all traffic
mosquitto_sub -h localhost -t "#" -v

# Monitor IS-07 topics only
mosquitto_sub -h localhost -t "x-nmos/events/#" -v

# Check connection
mosquitto_pub -h localhost -t "test" -m "hello"
```

#### 3. Verify IS-04 Registration

Check registry for registered resources:
```bash
# Query nodes
curl http://registry:8080/x-nmos/query/v1.3/nodes

# Query devices
curl http://registry:8080/x-nmos/query/v1.3/devices

# Query sources
curl http://registry:8080/x-nmos/query/v1.3/sources

# Query receivers
curl http://registry:8080/x-nmos/query/v1.3/receivers
```

#### 4. Test with Synthetic Messages

Use inject node or mosquitto_pub to send test grains:

```json
{
  "grain_type": "event",
  "source_id": "test-source-id",
  "flow_id": "test-flow-id",
  "origin_timestamp": "1731679200:0",
  "sync_timestamp": "1731679200:0",
  "creation_timestamp": "1731679200:0",
  "rate": {"numerator": 0, "denominator": 1},
  "duration": {"numerator": 0, "denominator": 1},
  "grain": {
    "type": "urn:x-nmos:format:data.event",
    "topic": "x-nmos/events/1.0/test-source-id/boolean",
    "data": [
      {"path": "button/1", "pre": false, "post": true}
    ]
  }
}
```

---

## MQTT Testing

### Install Mosquitto Tools

```bash
# Ubuntu/Debian
sudo apt-get install mosquitto-clients

# macOS
brew install mosquitto

# Windows
# Download from https://mosquitto.org/download/
```

### Test Commands

#### Subscribe to All Events
```bash
mosquitto_sub -h localhost -p 1883 -t "x-nmos/events/1.0/+/+" -v
```

#### Publish Button Press
```bash
mosquitto_pub -h localhost -p 1883 \
  -t "x-nmos/events/1.0/test-source/boolean" \
  -m '{
    "grain_type":"event",
    "source_id":"test-source",
    "flow_id":"test-flow",
    "origin_timestamp":"1731679200:0",
    "sync_timestamp":"1731679200:0",
    "creation_timestamp":"1731679200:0",
    "rate":{"numerator":0,"denominator":1},
    "duration":{"numerator":0,"denominator":1},
    "grain":{
      "type":"urn:x-nmos:format:data.event",
      "topic":"x-nmos/events/1.0/test-source/boolean",
      "data":[{"path":"button/1","pre":false,"post":true}]
    }
  }'
```

#### Publish Rotary Encoder
```bash
mosquitto_pub -h localhost -p 1883 \
  -t "x-nmos/events/1.0/test-source/number" \
  -m '{
    "grain_type":"event",
    "source_id":"test-source",
    "flow_id":"test-flow",
    "origin_timestamp":"1731679200:0",
    "sync_timestamp":"1731679200:0",
    "creation_timestamp":"1731679200:0",
    "rate":{"numerator":0,"denominator":1},
    "duration":{"numerator":0,"denominator":1},
    "grain":{
      "type":"urn:x-nmos:format:data.event",
      "topic":"x-nmos/events/1.0/test-source/number",
      "data":[{"path":"rotary/1","pre":0.50,"post":0.75}]
    }
  }'
```

#### Publish Tally State
```bash
mosquitto_pub -h localhost -p 1883 \
  -t "x-nmos/events/1.0/test-source/boolean" \
  -m '{
    "grain_type":"event",
    "source_id":"test-source",
    "flow_id":"test-flow",
    "origin_timestamp":"1731679200:0",
    "sync_timestamp":"1731679200:0",
    "creation_timestamp":"1731679200:0",
    "rate":{"numerator":0,"denominator":1},
    "duration":{"numerator":0,"denominator":1},
    "grain":{
      "type":"urn:x-nmos:format:data.event",
      "topic":"x-nmos/events/1.0/test-source/boolean",
      "data":[{"path":"tally/red","pre":false,"post":true}]
    }
  }'
```

---

## Best Practices

### 1. Resource ID Management

- **Don't regenerate IDs** unless absolutely necessary
- **Document IDs** in your system configuration
- **Backup configurations** before changing IDs

### 2. MQTT QoS Selection

- **QoS 0**: Low latency, use for real-time tally
- **QoS 1**: Reliable delivery, use for commands
- **QoS 2**: Exactly once, use for critical state changes

### 3. Subscription Filters

- **Start broad** (`x-nmos/events/1.0/+/+`) during development
- **Narrow scope** in production to reduce processing
- **Filter by source** when working with specific devices

### 4. Error Handling

```javascript
// In function nodes
if (!msg.smartpanel || !msg.smartpanel.commands) {
    return null; // No commands, skip
}

for (const cmd of msg.smartpanel.commands) {
    try {
        // Process command
    } catch (err) {
        node.error(`Command processing error: ${err.message}`);
    }
}
```

### 5. Button Display Updates

- **Batch updates** when changing multiple buttons
- **Track state** to avoid redundant updates
- **Use meaningful labels** (max 8-12 characters)
- **Consider color meanings** (red=danger, green=active, amber=warning)

### 6. Performance

- **Limit command history** (default 100 is reasonable)
- **Clear history** periodically if not needed
- **Use efficient filtering** in downstream function nodes

### 7. Production Deployment

- **Use static IPs** for MQTT broker and registry
- **Enable MQTT TLS** (mqtts://) in production
- **Monitor heartbeat** failures
- **Log important events** for troubleshooting

---

## Advanced Topics

### Custom Event Types

Beyond the standard Smartpanel patterns, you can handle any IS-07 event:

```javascript
// In function node after Smartpanel node
for (const item of msg.payload.grain.data) {
    if (item.path.startsWith('custom/')) {
        // Handle custom paths
        node.log(`Custom event: ${item.path} = ${item.post}`);
    }
}
```

### Multi-Panel Setups

Track commands from multiple Smartpanel sources:

```javascript
// Store panel states
const panelStates = flow.get('panelStates') || {};

if (msg.smartpanel && msg.smartpanel.commands) {
    panelStates[msg.source_id] = {
        lastCommand: msg.smartpanel.commands[0],
        timestamp: new Date().toISOString()
    };
    flow.set('panelStates', panelStates);
}
```

### State Synchronization

Keep button displays synchronized across multiple panels:

```javascript
// Broadcast button state to all panels
msg = {
    action: "set_multiple_buttons",
    buttons: flow.get('globalButtonStates') || []
};
return msg;
```

### Integration with Other Systems

#### Dante Audio
```javascript
// Update Smartpanel button labels from Dante device status
const danteDevices = msg.payload.devices;
msg = {
    action: "set_multiple_buttons",
    buttons: danteDevices.map((dev, i) => ({
        button: i + 1,
        text: dev.name,
        color: dev.online ? 'green' : 'red'
    }))
};
```

#### Vision Mixer
```javascript
// Update Smartpanel from vision mixer program/preview
if (msg.payload.program === 1) {
    msg = {
        action: "set_button_text",
        button: 1,
        text: "CAM 1",
        color: "red"  // Program
    };
}
```

### Security Considerations

1. **MQTT Authentication**
   - Configure username/password in MQTT broker
   - Use TLS/SSL for encrypted transport

2. **Network Isolation**
   - Keep production network separate
   - Use VLANs for broadcast equipment

3. **Access Control**
   - Limit registry access
   - Control who can publish to MQTT topics

4. **Monitoring**
   - Log all command activity
   - Alert on connection failures
   - Track unusual patterns

---

## Summary

The **nmos-smartpanel** node provides a complete, production-ready solution for Riedel Smartpanel integration with full AMWA NMOS IS-07 compliance. Key features include:

✅ Comprehensive command parsing (buttons, rotary, GPIO, tally, faders)
✅ Button display text writing
✅ IS-04 automatic registration
✅ Robust error handling
✅ Command history tracking
✅ Multi-source support

For additional assistance:
- Review the example flows in `examples/smartpanel-example.json`
- Check the Node-RED debug panel for detailed logging
- Use MQTT tools to inspect event traffic
- Consult the AMWA IS-07 specification for advanced use cases

**Version**: 3.0.0  
**Last Updated**: November 2024  
**License**: Apache 2.0

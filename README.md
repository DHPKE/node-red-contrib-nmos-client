# node-red-contrib-nmos-client

Complete NMOS implementation for Node-RED with IS-04, IS-05, IS-07, and IS-12 support.

[![npm version](https://badge.fury.io/js/node-red-contrib-nmos-client.svg)](https://www.npmjs.com/package/node-red-contrib-nmos-client)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Overview

This Node-RED package provides NMOS (Networked Media Open Specifications) support for broadcast and professional media workflows, implementing AMWA NMOS specifications for discovery, connection management, events, and device control.

## Features

- **IS-04**: Query and register NMOS resources (nodes, devices, sources, flows, senders, receivers)
- **IS-05**: Create and manage connections between senders and receivers
- **IS-07**: Publish and subscribe to MQTT-based events and tally
- **IS-12**: Control protocol (NCP) for device control via WebSocket
- **Dashboard**: Interactive routing matrix UI for FlowFuse Dashboard

## Installation

### Via Node-RED Palette Manager
1. Open Node-RED editor
2. Go to Menu → Manage palette
3. Search for `node-red-contrib-nmos-client`
4. Click Install

### Via npm
```bash
cd ~/.node-red
npm install node-red-contrib-nmos-client
```

## Quick Start

1. Add an `nmos-config` node and configure your NMOS registry URL
2. Use `nmos-query` to discover resources
3. Use `nmos-connection` to route senders to receivers
4. Optional: Import the dynamic matrix flow for visual routing control

## Nodes

### Configuration Nodes

#### nmos-config
Configure NMOS registry connection. Required by all other nodes.
- Registry URL (e.g., `http://192.168.1.100:8080`)
- API versions for Query, Registration, and Connection
- Authentication credentials (optional)

### Client Nodes

#### nmos-query
Query NMOS resources from the registry.

**Input:**
- `msg.resourceType`: `nodes`, `devices`, `sources`, `flows`, `senders`, `receivers`
- `msg.filter`: Query filter object (optional)

**Output:**
- `msg.payload`: Array of matching resources

#### nmos-get-one
Get a single resource with IS-05 connection details.

**Input:**
- `msg.resourceType`: `sender` or `receiver`
- `msg.resourceId`: UUID of the resource

**Output:**
- `msg.payload`: Complete resource with IS-05 data

#### nmos-connection
Create and manage IS-05 connections.

**Input:**
- `msg.receiverId`: Receiver UUID (required)
- `msg.senderId`: Sender UUID (null to disconnect)
- `msg.operation`: `activate`, `stage`, or `disconnect`

**Output:**
- `msg.payload`: Connection result with status

**Example:**
```javascript
msg.receiverId = "receiver-uuid";
msg.senderId = "sender-uuid";
msg.operation = "activate";
```

#### nmos-websocket
Subscribe to real-time resource updates via WebSocket.

**Input:**
- `msg.resourceType`: Resource type to monitor
- `msg.filter`: Subscription filter (optional)

**Output:**
- `msg.payload`: Resource update event
- `msg.event`: `added`, `modified`, or `removed`

#### nmos-matrix
Complete routing matrix node with automated discovery and snapshot management.

**Features:**
- Automatic discovery of senders and receivers
- IS-05 routing operations
- Snapshot save/load/export/import
- FlowFuse Dashboard integration with two UI styles:
  - **NMOS Standard**: Traditional matrix view
  - **Dante Controller Style**: Professional Dante-inspired interface with advanced features
- Programmatic control via messages

**Dante Controller Style Features:**
- Dual view modes (Grid and List)
- Device filtering and grouping
- Route locking and confirmation dialogs
- Status panel with real-time metrics
- Advanced visual indicators
- Professional dark theme

**Input:**
- `msg.payload.action`: `refresh`, `route`, `disconnect`, `save_snapshot`, `load_snapshot`, `get_state`
- Action-specific parameters (sender_id, receiver_id, snapshot, etc.)

**Output:**
- `msg.payload.event`: `route_changed`, `snapshot_saved`, `error`, etc.
- Event-specific data

**Example:**
```javascript
// Create a route
msg.payload = {
    action: "route",
    sender_id: "sender-uuid",
    receiver_id: "receiver-uuid"
};

// Save snapshot
msg.payload = {
    action: "save_snapshot",
    name: "Production Setup",
    description: "Main configuration"
};
```

See [NMOS_MATRIX_NODE.md](NMOS_MATRIX_NODE.md) for complete documentation and [examples/dante-matrix-example.json](examples/dante-matrix-example.json) for a Dante-style demo flow.



### Device Nodes

#### nmos-node
Register as an IS-05 routable receiver.

**Configuration:**
- Node/Device/Receiver labels
- HTTP Port for IS-05 API
- Auto-generated UUIDs

**Features:**
- Automatic IS-04 registration
- IS-05 Connection API endpoints
- Heartbeat maintenance
- Connection state management

#### nmos-is07-events
Publish and subscribe to IS-07 events via MQTT.

**Configuration:**
- Device and source labels
- Event type: `boolean`, `string`, `number`, `enum`, `object`
- MQTT broker URL and QoS

**Input Actions:**
- `send_state`: Publish current state (rebootstrap)
- `set_property`: Update property and publish event
- `send_event`: Send custom event

**Example:**
```javascript
msg.payload = {
    action: "set_property",
    path: "tally/red",
    value: true
};
```

#### nmos-is07-endpoint
Receive control commands and tally from IS-07 sources including RIEDEL Smartpanel.

**Configuration:**
- Device and receiver labels
- Subscription filter (MQTT topic pattern)
- MQTT broker URL and QoS
- Optional Smartpanel command parsing
- Optional status update publishing

**Features:**
- Subscribe to IS-07 events from any source
- Automatic RIEDEL Smartpanel command parsing (GPIO, buttons, tally, faders)
- Bidirectional communication (receive commands, send status)
- Command history tracking
- State management from multiple sources
- IS-04 receiver registration

**Input Actions:**
- `get_state`: Get endpoint configuration and status
- `get_received_states`: Query all received property states
- `get_command_history`: Get recent command history
- `send_status`: Publish status update back to sources
- `clear_history`: Clear command history
- `clear_states`: Clear received states

**Output:**
Outputs received IS-07 grain messages with optional parsed Smartpanel commands.

**Example:**
```javascript
// Output message with parsed Smartpanel command
{
    "payload": { /* IS-07 grain */ },
    "smartpanel": {
        "commands": [{
            "type": "button",
            "button": 1,
            "pressed": true
        }]
    }
}
```

**Documentation:**
See [IS-07 Endpoint & Smartpanel Guide](docs/is07-endpoint-smartpanel.md) for complete setup and integration instructions.

#### nmos-riedel-artist
Intercom matrix control and panel management for RIEDEL Artist systems via NMOS, with complete support for SmartPanel 1200 series.

**Configuration:**
- Panel type: generic, 1100, 2300, smartpanel
- **SmartPanel Preset:** RSP-1216HL, RSP-1232HL (for 1200 series panels)
- Device and panel labels
- MQTT broker URL and QoS
- Enable/disable key control and audio routing features

**Features:**
- Panel registration and discovery via IS-04
- Key assignment configuration (labels, modes, colors)
- Audio routing control in Artist matrix
- Status monitoring and panel management
- IS-07 event-based communication via MQTT
- Bidirectional Artist command processing
- Command history tracking
- **SmartPanel 1200 series support:**
  - LED color control (red, green, amber, off)
  - LED brightness control (0-100)
  - OLED display text writing (4 displays, 2 lines each, 16 chars per line)
  - Rotary encoder events (left, right, push)
  - Button press/release events
  - LeverKey up/down events
  - Predefined color profiles (idle, active, warning, off)

**Input Actions:**
- `configure_key`: Set up panel key with label and mode
- `key_action`: Simulate or handle key press/release
- `create_route`: Create audio route between panels
- `remove_route`: Remove audio route
- `get_keys`: Query all configured keys
- `get_routes`: Query all active routes
- `get_state`: Get panel configuration and status
- `update_panel_status`: Update panel status information
- `get_command_history`: Query recent Artist commands
- **SmartPanel Actions:**
  - `set_led_color`: Control LED color and brightness
  - `send_display_text`: Write text to display (2 lines)
  - `send_display_line`: Write text to specific display line
  - `apply_color_profile`: Apply predefined LED color profile
  - `get_smartpanel_preset`: Get active preset configuration

**Output:**
Outputs received Artist commands and events with parsed command data. SmartPanel events include button presses, leverkey positions, and rotary encoder movements.

**Example:**
```javascript
// Configure a panel key
msg.payload = {
    action: "configure_key",
    key: 1,
    config: {
        label: "Director",
        mode: "both",  // talk, listen, or both
        color: "green",
        enabled: true
    }
};

// Create audio route
msg.payload = {
    action: "create_route",
    sourceId: "director-panel-id",
    destinationId: "camera-op-panel-id",
    config: {
        gain: 0.0,
        mode: "both"
    }
};

// SmartPanel: Set LED color
msg.payload = {
    action: "set_led_color",
    keyId: 5,
    color: "red",
    brightness: 100
};

// SmartPanel: Send display text
msg.payload = {
    action: "send_display_text",
    displayId: 1,
    text: "Camera 1\nReady"
};
```

**SmartPanel 1200 Series:**

The node includes built-in presets for RIEDEL 1200 series SmartPanels:

- **RSP-1216HL**: 16 keys, 4 OLED displays, 4 rotary encoders, 8 leverkeys
- **RSP-1232HL**: 32 keys, 4 OLED displays, 4 rotary encoders, 16 leverkeys

Each display supports 2 lines of 16 characters. LEDs support red, green, amber colors with 0-100% brightness control.

**IS-07 Event Paths:**

Input events (Panel → Node-RED):
- `rotary/N/left`, `rotary/N/right`, `rotary/N/push` - Rotary encoder actions
- `button/N/press`, `button/N/release` - Button events
- `leverkey/N/up`, `leverkey/N/down` - LeverKey position events
- `artist/key/N/press`, `artist/key/N/release` - Artist key actions

Output commands (Node-RED → Panel):
- `led/N/color` - Set LED color and brightness
- `display/N/text` - Write text to display
- `display/N/line/1`, `display/N/line/2` - Write to specific display line

**Integration:**
- Supports RIEDEL Artist 1100, 2300, and SmartPanel models including RSP-1216HL and RSP-1232HL
- Compatible with NMOS IS-04, IS-05, IS-07, and IS-12
- Integrates with existing IS-07 infrastructure
- Works alongside nmos-is07-endpoint for complete RIEDEL integration
- Automatic IS-04 registration with heartbeat maintenance
- Auto re-registration on connection loss

See example flows:
- [examples/riedel-artist-example.json](examples/riedel-artist-example.json) - Basic Artist workflows
- [examples/riedel-smartpanel-rsp1216hl-example.json](examples/riedel-smartpanel-rsp1216hl-example.json) - RSP-1216HL complete example
- [examples/riedel-smartpanel-rsp1232hl-example.json](examples/riedel-smartpanel-rsp1232hl-example.json) - RSP-1232HL complete example


#### nmos-is12-control
Implement IS-12 controllable device with WebSocket transport.

**Configuration:**
- Device label and description
- Control type: `generic`, `mixer`, `processor`, `router`
- WebSocket port (default: 3001)

**WebSocket Endpoint:**
- Path: `ws://<ip>:<port>/x-nmos/ncp/v1.0`
- Protocol: NMOS Control Protocol (NCP)

**Built-in Controls:**
- **gain**: -60.0 to 12.0 dB
- **mute**: Boolean on/off
- **level**: Read-only meter

**Example:**
```javascript
msg.payload = {
    action: "set_property",
    role: "gain",
    value: -6.0
};
```

## Dynamic Matrix Flow

A complete flow-based NMOS routing matrix is available in the `examples` directory. This modular approach provides full routing control without requiring dashboard dependencies.

📖 **[Full Documentation](MATRIX_FLOW.md)** - Complete guide with examples, API reference, and integration options

### Features
- **Modular Architecture**: Separate query, processing, and routing nodes
- **Vue.js UI**: Standalone web interface at `http://localhost:1880/nmos-matrix`
- **Real-time Updates**: WebSocket subscriptions for live resource changes
- **IS-05 Routing**: Full connection management with staged/activate workflow
- **Snapshot Management**: Save, export, import, and apply routing configurations
- **No Dashboard Required**: Works with any Node-RED installation

### Quick Start

1. Import `examples/dynamic-matrix-flow.json` into Node-RED
2. Configure the `nmos-config` node with your registry URL
3. Deploy the flow
4. Open `http://localhost:1880/nmos-matrix` in your browser
5. Click crosspoints to route senders to receivers
6. Use snapshot buttons to save, export, import, and restore routing configurations

### Architecture

The flow consists of five main sections:

#### 1. Query NMOS Resources
- Inject nodes poll senders and receivers every 5 seconds
- `nmos-query` nodes fetch resources from IS-04 registry
- Automatic discovery keeps the matrix updated

#### 2. Process & Store Data
- Function nodes transform raw NMOS data
- Extract active connections from receiver subscriptions
- Store in flow context for matrix UI access

#### 3. Matrix UI Endpoints
- `GET /nmos-matrix` - Serves the Vue.js matrix interface
- `GET /nmos-matrix/data` - Returns current matrix data as JSON
- Responsive design with search/filter capabilities

#### 4. Routing Operations
- `POST /nmos-matrix/route` - Accepts routing requests from UI
- Routes through `nmos-connection` node for IS-05 operations
- Supports connect, disconnect, and staged operations

#### 5. WebSocket Updates (Optional)
- Subscribe to real-time sender/receiver changes
- Automatic matrix updates when devices are added/removed
- Minimal polling overhead

### Integration Options

#### Option 1: Native Flow (Default)
The provided flow uses built-in NMOS nodes and a custom Vue UI. This is self-contained and requires no external dependencies beyond Node-RED and an NMOS registry.

#### Option 2: nmos_crosspoint Integration
To integrate with the [DHPKE/nmos_crosspoint](https://github.com/DHPKE/nmos_crosspoint) application:

1. Clone and run nmos_crosspoint:
```bash
git clone https://github.com/DHPKE/nmos_crosspoint
cd nmos_crosspoint
npm install
npm start
```

2. Replace the matrix UI template node with an iframe:
```html
<iframe src="http://localhost:3000" width="100%" height="100%" frameborder="0"></iframe>
```

3. Configure nmos_crosspoint to use your NMOS registry

4. Use crosspoint's built-in routing and visualization features

Both approaches support the same NMOS IS-04/IS-05 workflows and can be switched without changing the query or connection logic.

## Examples

Example flows are available in the `examples` directory:
- **dynamic-matrix-flow.json**: Complete modular matrix with Vue UI
- **is12-control-example.json**: IS-12 device control demonstration
- **is07-endpoint-smartpanel-example.json**: IS-07 endpoint with RIEDEL Smartpanel integration examples
- **riedel-artist-example.json**: RIEDEL Artist intercom matrix control workflows
- **riedel-smartpanel-rsp1216hl-example.json**: Complete RSP-1216HL SmartPanel example with LED/display control
- **riedel-smartpanel-rsp1232hl-example.json**: Complete RSP-1232HL SmartPanel example with 32-key support

## License

Apache 2.0 - See [LICENSE](LICENSE) file for details.

## Contributing

Issues and pull requests are welcome at [GitHub](https://github.com/DHPKE/node-red-contrib-nmos-client).

## Support

For questions and support, please open an issue on GitHub.

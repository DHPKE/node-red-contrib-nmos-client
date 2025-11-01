# node-red-contrib-nmos-client

Complete NMOS implementation for Node-RED with IS-04, IS-05, IS-07, and IS-12 support.

[![npm version](https://badge.fury.io/js/node-red-contrib-nmos-client.svg)](https://www.npmjs.com/package/node-red-contrib-nmos-client)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Overview

This Node-RED package provides comprehensive NMOS (Networked Media Open Specifications) support for broadcast and professional media workflows. It implements multiple AMWA NMOS specifications, enabling discovery, connection management, event handling, and device control.

## Features

### 🔍 IS-04 Discovery & Registration
- Query NMOS resources (nodes, devices, sources, flows, senders, receivers)
- Register as NMOS Node/Device/Receiver/Source
- Automatic heartbeat maintenance with registry
- WebSocket subscriptions for real-time resource updates
- Support for multiple API versions (v1.0, v1.1, v1.2, v1.3)

### 🔌 IS-05 Connection Management
- Create and modify connections between senders and receivers
- Full Connection API implementation
- SDP file handling and generation
- Multiple activation modes:
  - `activate_immediate` - Instant activation
  - `activate_scheduled_absolute` - Time-based activation
  - `activate_scheduled_relative` - Relative time activation
- Transport parameter configuration
- Disconnect operations

### 📡 IS-07 Event & Tally
- MQTT-based event transport (AMWA IS-07 compliant)
- State messages (rebootstrap) with MQTT retained flag
- Event messages (deltas) with pre/post value tracking
- Grain message format with TAI timestamps
- Full IS-04 registration (node, device, source, flow)
- Topic structure: `x-nmos/events/1.0/{source_id}/{event_type}`
- Property state management and tracking
- Support for multiple data types:
  - Boolean (true/false states)
  - String (text values)
  - Number (numeric values)
  - Enum (enumerated options)
  - Object (complex data structures)

### 🎛️ IS-12 Control Protocol (NCP)
- MQTT-based control transport
- NC (NMOS Control) protocol implementation
- Property get/set operations
- Real-time property change notifications
- Controllable device registration with IS-04
- Bi-directional control capabilities
- Built-in control model with:
  - Gain control (with range limits)
  - Mute control
  - Level metering (read-only)
- Extensible worker architecture

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

### From Source
```bash
cd ~/.node-red
git clone https://github.com/DHPKE/node-red-contrib-nmos-client.git
cd node-red-contrib-nmos-client
npm install
```

## Nodes

### Configuration Nodes

#### nmos-config
Configuration node for NMOS registry connection. Required by all other nodes.

**Configuration:**
- Registry URL (e.g., `http://192.168.1.100:8080`)
- Query API Version (v1.0, v1.1, v1.2, v1.3)
- Registration API Version
- Connection API Version (for IS-05)
- Authentication credentials (optional)

### Client Nodes

#### nmos-query
Query NMOS resources from the registry.

**Inputs:**
- `msg.resourceType` - Resource type to query: `nodes`, `devices`, `sources`, `flows`, `senders`, `receivers`
- `msg.filter` - Query filter object (optional)
  - Example: `{ format: "urn:x-nmos:format:video" }`
  - Example: `{ transport: "urn:x-nmos:transport:rtp" }`

**Outputs:**
- `msg.payload` - Array of matching resources
- `msg.count` - Number of resources found
- `msg.resourceType` - The queried resource type

**Example:**
```javascript
// Query all video senders
msg.resourceType = "senders";
msg.filter = { format: "urn:x-nmos:format:video" };
return msg;
```

#### nmos-get-one
Get a single resource with detailed IS-05 connection information.

**Inputs:**
- `msg.resourceType` - Type: `sender` or `receiver`
- `msg.resourceId` - UUID of the resource

**Outputs:**
- `msg.payload` - Complete resource with IS-05 data
- `msg.is05` - Connection API endpoints (if available)

**Example:**
```javascript
// Get receiver details
msg.resourceType = "receiver";
msg.resourceId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
return msg;
```

#### nmos-connection
Create and manage IS-05 connections between senders and receivers.

**Inputs:**
- `msg.receiverId` - Receiver UUID (required)
- `msg.senderId` - Sender UUID (null to disconnect)
- `msg.operation` - Operation type:
  - `"activate"` - Activate connection immediately
  - `"stage"` - Stage connection for later activation
  - `"disconnect"` - Disconnect receiver
- `msg.transportParams` - Transport parameters (optional)
- `msg.sdp` - SDP file content (optional)

**Outputs:**
- `msg.payload` - Connection result with status
- `msg.staged` - Staged connection state
- `msg.active` - Active connection state (after activation)

**Examples:**
```javascript
// Immediate connection
msg.receiverId = "receiver-uuid";
msg.senderId = "sender-uuid";
msg.operation = "activate";

// Disconnect
msg.receiverId = "receiver-uuid";
msg.senderId = null;
msg.operation = "disconnect";

// Custom transport parameters
msg.receiverId = "receiver-uuid";
msg.senderId = "sender-uuid";
msg.operation = "activate";
msg.transportParams = [{
    destination_port: 5004,
    source_ip: "192.168.1.100",
    multicast_ip: "239.0.0.1"
}];
```

#### nmos-websocket
Subscribe to real-time resource updates via WebSocket.

**Inputs:**
- `msg.resourceType` - Type to subscribe: `nodes`, `devices`, `sources`, `flows`, `senders`, `receivers`
- `msg.filter` - Subscription filter (optional)

**Outputs:**
- `msg.payload` - Resource update event
- `msg.event` - Event type: `added`, `modified`, `removed`
- `msg.resourceType` - Type of changed resource

**Example:**
```javascript
// Subscribe to sender changes
msg.resourceType = "senders";
msg.filter = { format: "urn:x-nmos:format:video" };
return msg;
```

#### nmos-matrix-ui
Visual NMOS sender-receiver routing matrix for Node-RED Dashboard 2.

**Configuration:**
- Registry - NMOS registry configuration (required)
- Group - Dashboard 2 UI group (required)
- Width - Dashboard widget width (1-24, default: 12)
- Height - Dashboard widget height (1-24, default: 8)

**Features:**
- Interactive crosspoint matrix grid layout
- Sticky headers for easy navigation with large matrices
- Click crosspoints to toggle connections
- Active connections highlighted in teal (#3FADB5)
- Real-time search/filter for senders and receivers
- Refresh button to reload resources from registry
- Status bar showing counts and loading state
- Supports up to 500 senders and receivers

**Inputs:**
- `msg.payload.action = "route"` - Trigger routing operation
  - `msg.payload.receiverId` - Receiver UUID
  - `msg.payload.senderId` - Sender UUID (null to disconnect)
  - `msg.payload.operation` - "activate" or "disconnect"
- `msg.payload.action = "refresh"` - Reload resources

**Outputs:**
- Routing messages in `nmos-connection` format:
  - `msg.receiverId` - Receiver UUID
  - `msg.senderId` - Sender UUID (null for disconnect)
  - `msg.operation` - "activate" or "disconnect"

**Usage Example:**
```
[nmos-matrix-ui] → [nmos-connection] → [debug]
```

**Matrix Interaction:**
1. Click an empty crosspoint to connect sender to receiver
2. Click an active crosspoint (teal) to disconnect
3. Use search boxes to filter by sender/receiver labels
4. Click refresh to update resource list and connection states
5. Scroll the matrix for large numbers of senders/receivers

**Requirements:**
- Node-RED Dashboard 2 (`@flowfuse/node-red-dashboard`)
- Configured NMOS registry (`nmos-config` node)

**Implementation Notes:**
- The node provides HTTP endpoints for fetching resources and connections
- The Vue component (`ui/components/NmosMatrix.vue`) implements the matrix UI
- For Dashboard 2 integration, the widget is registered automatically when Dashboard 2 is installed
- Backend node handles routing message generation and passes to `nmos-connection` node
- Connection state is queried from IS-04 registry receiver subscriptions

### Device Nodes

#### nmos-node
Register as an IS-05 routable receiver with full NMOS compliance.

**Configuration:**
- Node Label
- Node Description
- HTTP Port (for IS-05 API)
- Node ID (auto-generated if not provided)
- Device ID (auto-generated if not provided)
- Receiver ID (auto-generated if not provided)

**Inputs:**
- `msg.payload.action = "get_state"` - Get current state
- `msg.payload.action = "disconnect"` - Disconnect receiver
- `msg.payload.action = "re-register"` - Force re-registration

**Outputs:**
- Connection events when receiver is connected/disconnected
- `msg.payload.event` - Event type: `connection_activated`, `disconnected`
- `msg.payload.sender_id` - Connected sender UUID
- `msg.payload.transport_params` - Active transport parameters
- `msg.payload.sdp` - SDP file content

**Features:**
- Automatic IS-04 registration (node, device, receiver)
- IS-05 Connection API endpoints
- Heartbeat maintenance
- SDP generation
- Connection state management

#### nmos-is07-events
Publish and subscribe to IS-07 events via MQTT.

**Configuration:**
- Device Label
- Source Label
- Event Type: `boolean`, `string`, `number`, `enum`, `object`
- MQTT Broker URL (e.g., `mqtt://localhost:1883`)
- MQTT QoS (0, 1, or 2)
- Resource IDs (auto-generated if not provided)

**Inputs:**
- `msg.payload.action = "get_state"` - Get current state and IDs
- `msg.payload.action = "send_state"` - Publish state (rebootstrap)
- `msg.payload.action = "send_event"` - Send custom event
  - `msg.payload.path` - Property path
  - `msg.payload.pre` - Previous value
  - `msg.payload.post` - New value
- `msg.payload.action = "set_property"` - Update property and publish event
  - `msg.payload.path` - Property path (e.g., `"tally/red"`)
  - `msg.payload.value` - New value
- `msg.payload.action = "re-register"` - Force re-registration

**Outputs:**
- Incoming events from other IS-07 sources
- `msg.payload` - Grain message with event data
- `msg.source_id` - Source UUID of event publisher
- `msg.flow_id` - Flow UUID

**Examples:**
```javascript
// Publish state (rebootstrap)
msg.payload = { action: "send_state" };

// Update tally property
msg.payload = {
    action: "set_property",
    path: "tally/red",
    value: true
};

// Send custom event
msg.payload = {
    action: "send_event",
    path: "status",
    pre: "idle",
    post: "active"
};
```

**Features:**
- Full IS-04 registration (node, device, source, flow)
- TAI timestamp generation
- Grain message format compliance
- Property state tracking
- MQTT retained messages for state
- Automatic rebootstrap on connection

#### nmos-is12-control
Implement an IS-12 controllable device with MQTT transport.

**Configuration:**
- Device Label
- Device Description
- Control Type: `generic`, `audio`, `video`
- MQTT Broker URL
- Resource IDs (auto-generated if not provided)

**Built-in Control Model:**
- **gain** (OID 2): Float value with range -60.0 to 12.0 dB
- **mute** (OID 3): Boolean on/off control
- **level** (OID 4): Float meter value (read-only)

**Inputs:**
- `msg.payload.action = "get_state"` - Get device state and control model
- `msg.payload.action = "set_property"` - Update property value
  - `msg.payload.role` - Property role (e.g., `"gain"`, `"mute"`)
  - `msg.payload.value` - New value
- `msg.payload.action = "send_command"` - Send command to another device
  - `msg.payload.targetDevice` - Target device ID
  - `msg.payload.command` - NCP command object
- `msg.payload.action = "re-register"` - Force re-registration

**Outputs:**
- Property change events
- `msg.payload.event = "property_changed"`
- `msg.payload.oid` - Object ID
- `msg.payload.role` - Property role
- `msg.payload.value` - New value

**Examples:**
```javascript
// Set gain to -6 dB
msg.payload = {
    action: "set_property",
    role: "gain",
    value: -6.0
};

// Toggle mute
msg.payload = {
    action: "set_property",
    role: "mute",
    value: true
};

// Get current state
msg.payload = { action: "get_state" };
```

**Features:**
- IS-04 device registration with controls endpoint
- NCP protocol implementation
- MQTT command/response/notification topics
- Extensible control model
- Property validation and range checking
- Real-time notifications

## Requirements

### NMOS Registry (IS-04)
You need a running NMOS registry. Options include:
- [BBC NMOS Registry](https://github.com/bbc/nmos-registration)
- [Sony NMOS-cpp](https://github.com/sony/nmos-cpp)
- [Mellanox NMOS Registry](https://github.com/Mellanox/nmos-registry)

### MQTT Broker (for IS-07 and IS-12)
Required for event and control nodes:
- [Eclipse Mosquitto](https://mosquitto.org/)
- [EMQX](https://www.emqx.io/)
- [HiveMQ](https://www.hivemq.com/)

### Node-RED Dashboard 2 (for nmos-matrix-ui)
Required for the matrix UI node:
- [@flowfuse/node-red-dashboard](https://flows.nodered.org/node/@flowfuse/node-red-dashboard) v1.0.0 or higher

Install via Node-RED palette manager or:
```bash
cd ~/.node-red
npm install @flowfuse/node-red-dashboard
```

## Quick Start Examples

### 1. Query and Display Senders
```
[Inject] → [nmos-query] → [Debug]
```
Configure inject node:
```javascript
msg.resourceType = "senders";
msg.filter = { format: "urn:x-nmos:format:video" };
return msg;
```

### 2. Create Connection Between Sender and Receiver
```
[Inject] → [nmos-connection] → [Debug]
```
Configure inject node:
```javascript
msg.receiverId = "your-receiver-uuid";
msg.senderId = "your-sender-uuid";
msg.operation = "activate";
return msg;
```

### 3. Monitor Resource Changes
```
[nmos-websocket] → [Switch] → [Debug]
```
Configure switch node to filter by event type (added/modified/removed).

### 4. Publish IS-07 Tally Events
```
[Inject] → [nmos-is07-events] → [Debug]
```
Configure inject for tally red on:
```javascript
msg.payload = {
    action: "set_property",
    path: "tally/red",
    value: true
};
return msg;
```

### 5. Control IS-12 Device
```
[Inject] → [nmos-is12-control] → [Debug]
```
Configure inject to set gain:
```javascript
msg.payload = {
    action: "set_property",
    role: "gain",
    value: -6.0
};
return msg;
```

### 6. Visual Matrix Routing (Dashboard 2)
```
[nmos-matrix-ui] → [nmos-connection] → [Debug]
```
1. Configure `nmos-matrix-ui` with your registry and Dashboard 2 group
2. Open Dashboard 2 in your browser
3. View the interactive matrix with all senders and receivers
4. Click crosspoints to connect/disconnect
5. The matrix will send routing commands to `nmos-connection` for execution
6. Use search boxes to filter large matrices

## MQTT Topic Structure

### IS-07 Events
- **Publish:** `x-nmos/events/1.0/{source_id}/{event_type}`
- **Subscribe:** `x-nmos/events/1.0/+/+`

### IS-12 Control
- **Commands:** `x-nmos/nc/{device_id}/commands`
- **Responses:** `x-nmos/nc/{device_id}/responses`
- **Notifications:** `x-nmos/nc/{device_id}/notifications`
- **Subscriptions:** `x-nmos/nc/{device_id}/subscriptions`

## Troubleshooting

### Registration Issues
1. Verify registry URL is accessible
2. Check API version compatibility
3. Review Node-RED debug logs for error details
4. Ensure network interfaces are properly detected

### MQTT Connection Problems
1. Verify MQTT broker is running and accessible
2. Check firewall rules for MQTT port (default 1883)
3. Confirm MQTT broker allows anonymous connections (or provide credentials)
4. Review MQTT logs for connection errors

### Connection API Issues
1. Ensure HTTP port is not blocked by firewall
2. Verify receiver has proper IS-05 control endpoint
3. Check that sender SDP is accessible
4. Review transport parameter compatibility

### WebSocket Subscription Issues
1. Verify registry supports WebSocket subscriptions
2. Check that query API includes WebSocket endpoint
3. Monitor connection for timeout/disconnect events

## Examples

Complete flow examples are available in the `examples/` folder:
- `is12-control-example.json` - IS-12 control device demonstration

Import examples via Node-RED: Menu → Import → Examples → node-red-contrib-nmos-client

## API Compatibility

- **IS-04** v1.0, v1.1, v1.2, v1.3
- **IS-05** v1.0, v1.1
- **IS-07** v1.0
- **IS-12** v1.0

## Dependencies

- `axios` ^1.6.2 - HTTP client
- `ws` ^8.14.2 - WebSocket client
- `uuid` ^9.0.1 - UUID generation
- `mqtt` ^5.3.4 - MQTT client

## Contributing

Contributions are welcome! Please submit issues and pull requests on GitHub.

## License

Apache-2.0

## Credits

Based on [sony/nmos-js](https://github.com/sony/nmos-js)

## Author

DHPKE - 2025

## Links

- [GitHub Repository](https://github.com/DHPKE/node-red-contrib-nmos-client)
- [npm Package](https://www.npmjs.com/package/node-red-contrib-nmos-client)
- [AMWA NMOS Specifications](https://specs.amwa.tv/nmos/)
- [Node-RED](https://nodered.org/)

## Changelog

### v2.3.0 (2025-11-01)
- ✨ NEW: `nmos-matrix-ui` node for Node-RED Dashboard 2
- 🎛️ Interactive crosspoint matrix for visual sender-receiver routing
- 🎨 Dashboard 2 Vue component with real-time updates
- 🔍 Search and filter functionality for large matrices
- 🎯 Click-to-connect crosspoint interaction
- 📊 Support for up to 500 senders and receivers
- 🔄 Refresh button to reload resources and connections
- 📱 Responsive grid layout with sticky headers

### v2.2.0 (2025-11-01)
- 📝 Comprehensive README documentation update
- 📚 Complete function documentation for all nodes
- 🔧 Code optimizations and cleanup
- ✨ Enhanced examples and usage guides
- 📖 Added troubleshooting section
- 🎯 Improved MQTT topic documentation

### v2.1.0
- Added IS-07 Events & Tally support
- Added IS-12 Control Protocol support
- Enhanced IS-05 connection management
- Improved error handling

### v2.0.0
- Major refactor with multiple node types
- Full IS-04, IS-05 support
- WebSocket subscriptions

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
- **IS-12**: Control protocol (NCP) for device control via MQTT
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
4. Optional: Add `nmos-matrix-ui` for visual routing control

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

#### nmos-matrix-ui
Visual routing matrix for FlowFuse Dashboard.

**Configuration:**
- Registry: NMOS registry (required)
- Group: Dashboard UI group (required)
- Width/Height: Widget dimensions

**Features:**
- Interactive crosspoint matrix
- Click to connect/disconnect
- Search and filter
- Active connections highlighted

**Usage:**
Connect to `nmos-connection` node for automatic routing:
```
[nmos-matrix-ui] → [nmos-connection] → [debug]
```

**Requirements:**
- `@flowfuse/node-red-dashboard` v1.2.9 or higher

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

#### nmos-is12-control
Implement IS-12 controllable device with MQTT.

**Configuration:**
- Device label and description
- Control type: `generic`, `audio`, `video`
- MQTT broker URL

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

## Examples

Example flows are available in the `examples` directory:
- Basic query and connection
- WebSocket subscriptions
- IS-07 event publishing
- IS-12 device control
- Matrix UI routing

## License

Apache 2.0 - See [LICENSE](LICENSE) file for details.

## Contributing

Issues and pull requests are welcome at [GitHub](https://github.com/DHPKE/node-red-contrib-nmos-client).

## Support

For questions and support, please open an issue on GitHub.

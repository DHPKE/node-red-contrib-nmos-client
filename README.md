# node-red-contrib-nmos-client

Complete NMOS implementation for Node-RED with IS-04, IS-05, and IS-12 support.

## Features

### IS-04 Discovery & Registration
- ✅ Query NMOS resources (nodes, devices, sources, flows, senders, receivers)
- ✅ Register as NMOS Node/Device/Receiver
- ✅ Automatic heartbeat maintenance
- ✅ WebSocket subscriptions for real-time updates

### IS-05 Connection Management
- ✅ Create/modify connections between senders and receivers
- ✅ Full IS-05 Connection API implementation
- ✅ SDP file handling
- ✅ Activate immediate, stage, and disconnect operations

- ### IS-07 Event & Tally
- ✅ MQTT-based event transport
- ✅ State messages (rebootstrap) with retained flag
- ✅ Event messages (deltas) with pre/post tracking
- ✅ Grain message format with TAI timestamps
- ✅ IS-04 registration (node, device, source, flow)
- ✅ Topic structure: `x-nmos/events/1.0/{source_id}/{event_type}`
- ✅ Property state management
- ✅ Support for boolean, string, number, enum, object types

### IS-12 Control Protocol
- ✅ MQTT-based control transport
- ✅ NC (NMOS Control) protocol implementation
- ✅ Property get/set operations
- ✅ Real-time property change notifications
- ✅ Controllable device registration
- ✅ Bi-directional control capabilities

**Requirements:**
- NMOS registry (IS-04)
- MQTT broker for IS-12 (e.g., Mosquitto)

## Nodes

### Client Nodes
- **nmos-config** - Registry connection configuration
- **nmos-query** - Query for NMOS resources
- **nmos-get-one** - Get single resource with IS-05 data
- **nmos-connection** - Create/modify IS-05 connections
- **nmos-websocket** - Subscribe to real-time updates

### Device Nodes
- **nmos-node** - IS-05 routable receiver with full registration
- **nmos-is12-control** - IS-12 controllable device with MQTT

## Quick Start

### Query Resources
```javascript
[inject] → [nmos-query] → [debug]

// Query all video senders
msg.filter = { format: "urn:x-nmos:format:video" };
msg.resourceType = "senders";
```

### Create Connection
```javascript
[inject] → [nmos-connection] → [debug]

msg.receiverId = "receiver-uuid";
msg.senderId = "sender-uuid";
msg.operation = "activate";
```

#### IS-07

```javascript
// Publish state (rebootstrap)
msg.payload = { action: "send_state" };

// Update property and publish event
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

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-nmos-client
```

### IS-12 Control
```javascript
[inject] → [nmos-is12-control] → [debug]

// Set gain
msg.payload = {
    action: "set_property",
    role: "gain",
    value: -6.0
};
```

## Examples

See the `examples/` folder for complete flow examples.

## License

Apache-2.0

## Credits

Based on [sony/nmos-js](https://github.com/sony/nmos-js)

## Author

DHPKE - 2025

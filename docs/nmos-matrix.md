# NMOS Matrix Node Documentation

## Overview

The `nmos-matrix` node is a complete, self-contained NMOS routing matrix implementation for Node-RED. It provides automated endpoint discovery, click-to-route functionality, and snapshot management for NMOS IS-04/IS-05 workflows.

## Features

- **Automatic Discovery**: Polls IS-04 registry for senders and receivers
- **IS-05 Routing**: Create and remove connections between endpoints
- **Snapshot Management**: Save, export, import, and restore routing configurations
- **Message Control**: Programmatic control via input messages
- **Event Output**: Sends status updates and routing events
- **Multi-Instance Support**: Multiple nodes can coexist in one flow
- **FlowFuse Dashboard Ready**: Vue component available for dashboard integration

## Installation

The node is included in `node-red-contrib-nmos-client`. After installing the package, the `nmos-matrix` node will appear in the NMOS category of the Node-RED palette.

```bash
npm install node-red-contrib-nmos-client
```

## Configuration

### Required Settings

#### NMOS Registry
Select an `nmos-config` node that defines your IS-04 registry connection.

### Connection Settings

#### Auto Refresh
- **Type**: Boolean
- **Default**: `true`
- **Description**: Automatically poll registry for endpoint updates

#### Refresh Interval
- **Type**: Number (milliseconds)
- **Default**: `5000`
- **Description**: How often to poll the registry for updates
- **Range**: 1000-60000 (1-60 seconds recommended)

#### Connection Timeout
- **Type**: Number (milliseconds)
- **Default**: `30000`
- **Description**: Maximum time to wait for IS-05 connection operations

#### Retry Attempts
- **Type**: Number
- **Default**: `3`
- **Range**: 0-10
- **Description**: Number of retry attempts for failed connections

### Display Settings

#### Compact View
- **Type**: Boolean
- **Default**: `false`
- **Description**: Use smaller grid cells for large matrices

#### Show Labels
- **Type**: Boolean
- **Default**: `true`
- **Description**: Display sender/receiver labels (vs. numeric IDs)

#### Color Scheme
- **Type**: String
- **Default**: `"default"`
- **Options**: `default`, `dark`, `light`, `highcontrast`
- **Description**: Visual theme for the matrix UI

## Input Messages

Control the node by sending messages with `msg.payload.action`:

### Refresh Endpoints

```javascript
msg.payload = {
    action: "refresh"
};
```

### Create Route

```javascript
msg.payload = {
    action: "route",
    sender_id: "550e8400-e29b-41d4-a716-446655440000",
    receiver_id: "650e8400-e29b-41d4-a716-446655440001"
};
```

### Disconnect Route

```javascript
msg.payload = {
    action: "disconnect",
    receiver_id: "650e8400-e29b-41d4-a716-446655440001"
};
```

### Save Snapshot

```javascript
msg.payload = {
    action: "save_snapshot",
    name: "Production Setup 1",
    description: "Main routing configuration"
};
```

### Load Snapshot

```javascript
msg.payload = {
    action: "load_snapshot",
    snapshot: {
        version: "1.0",
        routes: [/* route objects */]
    }
};
```

### Get Current State

```javascript
msg.payload = {
    action: "get_state"
};
```

## Output Messages

The node sends events on its output:

- `route_changed`: Route created or removed
- `snapshot_saved`: Snapshot saved successfully
- `snapshot_loaded`: Snapshot applied successfully
- `refreshed`: Endpoints refreshed
- `state`: Current state returned
- `error`: Operation failed

See full documentation for detailed message formats.

## FlowFuse Dashboard Integration

1. Install `@flowfuse/node-red-dashboard`
2. Use the Vue component from `ui/nmos-matrix.vue`
3. Set `nodeId` prop to match your matrix node

## Snapshot Format

```json
{
  "version": "1.0",
  "timestamp": "2025-11-02T14:25:35Z",
  "name": "Snapshot Name",
  "description": "Description",
  "routes": [
    {
      "sender_id": "uuid",
      "receiver_id": "uuid",
      "sender_label": "Sender",
      "receiver_label": "Receiver"
    }
  ]
}
```

## Support

- GitHub: https://github.com/DHPKE/node-red-contrib-nmos-client
- NMOS Specs: https://specs.amwa.tv/nmos

## License

Apache 2.0

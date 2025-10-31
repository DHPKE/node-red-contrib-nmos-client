# GitHub Copilot Instructions for node-red-contrib-nmos-client

This repository provides a complete NMOS (Networked Media Open Specifications) implementation for Node-RED, supporting IS-04, IS-05, IS-07, and IS-12 protocols.

## Project Overview

This is a Node-RED contribution package that provides nodes for NMOS protocol communication in broadcast and media environments. It enables users to:
- Discover and query NMOS resources (IS-04)
- Manage connections between media devices (IS-05)
- Handle events and tally (IS-07)
- Control devices via MQTT (IS-12)

## Technology Stack

- **Runtime**: Node.js (>=14.0.0)
- **Framework**: Node-RED node development
- **Key Dependencies**:
  - `axios` - HTTP client for NMOS API calls
  - `ws` - WebSocket support for real-time updates
  - `uuid` - UUID generation for NMOS resource IDs
  - `mqtt` - MQTT client for IS-07 and IS-12 protocols

## Code Structure

### Node Files Organization
Each Node-RED node consists of two files:
- `nodes/<node-name>.js` - Backend logic (Node.js)
- `nodes/<node-name>.html` - Frontend UI definition and help text

### Node Development Patterns

#### 1. Node Registration
```javascript
module.exports = function(RED) {
    function MyNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        // Implementation
    }
    RED.nodes.registerType("my-node", MyNode);
}
```

#### 2. Configuration Nodes
- Use `nmos-config` as the registry configuration node
- Access via: `this.registry = RED.nodes.getNode(config.registry);`
- Configuration nodes have credentials support for auth

#### 3. Status Indicators
Use node.status() to show connection/operation state:
```javascript
node.status({fill: "green", shape: "dot", text: "connected"});
node.status({fill: "red", shape: "ring", text: "error"});
node.status({fill: "yellow", shape: "ring", text: "connecting"});
```

#### 4. Error Handling
- Use `node.error()` for errors
- Use `node.warn()` for warnings
- Always validate configuration before operations

## NMOS Protocol Specifics

### IS-04 (Discovery & Registration)
- **Query API**: `/x-nmos/query/{version}/{resource-type}`
- **Resource Types**: nodes, devices, sources, flows, senders, receivers
- **Filtering**: Support both RQL (Resource Query Language) and basic key-value filters
- **Paging**: Use `paging.limit` and `paging.since` parameters
- **WebSocket**: Subscribe to resource changes at `/x-nmos/query/{version}/subscriptions`

### IS-05 (Connection Management)
- **Base Path**: `/x-nmos/connection/{version}`
- **Operations**: 
  - GET /single - Get current connection details
  - PATCH /staged - Stage connection parameters
  - PATCH /active - Activate connection
- **SDP Handling**: Transport files for media streams
- **Activation Modes**: immediate, scheduled, null (disconnect)

### IS-07 (Event & Tally)
- **Transport**: MQTT-based
- **Topic Structure**: `x-nmos/events/1.0/{source_id}/{event_type}`
- **Message Types**:
  - State (rebootstrap) - Full property state with retained flag
  - Event (delta) - Property changes with pre/post values
- **Grain Format**: NMOS grain structure with TAI timestamps
- **Property Types**: boolean, string, number, enum, object

### IS-12 (Control Protocol)
- **Transport**: MQTT-based
- **Protocol**: NC (NMOS Control) protocol
- **Operations**: Property get/set with notifications
- **Device Registration**: Register as controllable device in IS-04
- **Control Topics**: Bi-directional command/response model

## API Patterns

### Query API Usage
```javascript
const url = `${registry.getQueryApiUrl()}/${resourceType}`;
const response = await axios.get(url, {
    headers: registry.getAuthHeaders(),
    params: { /* filters */ }
});
```

### RQL Encoding
- Use `encodeRQLNameChars()` for string values
- Support operators: `eq()`, `matches()`, `or()`, `and()`
- Case-insensitive string matching with `string:` prefix

### WebSocket Subscriptions
- Maintain persistent connections
- Handle reconnection with exponential backoff
- Parse subscription data and resource_path

## Message Flow Patterns

### Input Messages
Nodes typically expect messages with specific payload structures:
```javascript
msg.resourceType = "senders";  // For query nodes
msg.filter = { format: "urn:x-nmos:format:video" };
msg.senderId = "uuid";  // For connection nodes
msg.receiverId = "uuid";
```

### Output Messages
Nodes send results via:
```javascript
node.send(msg);  // Success case
node.error("Error message", msg);  // Error case
```

## Best Practices

### 1. Async Operations
- Always use async/await for HTTP requests
- Handle timeouts appropriately (default: 5000ms)
- Implement proper error handling with try-catch

### 2. Resource Cleanup
```javascript
node.on('close', function(done) {
    // Close connections, clear timers
    if (wsConnection) wsConnection.close();
    if (mqttClient) mqttClient.end();
    done();
});
```

### 3. Heartbeat Mechanisms
For device nodes that register with IS-04:
- Send periodic heartbeat to registry
- Default interval: 5 seconds
- Handle registration failures gracefully

### 4. UUID Management
- Use `uuid.v4()` for generating NMOS resource IDs
- Validate UUIDs before use
- Maintain consistent IDs across restarts when needed

### 5. MQTT Patterns
- QoS levels: Use QoS 1 for reliable delivery
- Retained messages: Use for state (rebootstrap) messages
- Clean session: Consider persistence requirements
- Reconnection: Implement automatic reconnect with backoff

## Testing Approach

This repository currently has no formal test infrastructure. When adding tests:
- Follow Node-RED testing patterns
- Mock external NMOS registry and MQTT broker
- Test both success and error paths
- Validate message transformations

## Common Pitfalls to Avoid

1. **Registry URL**: Always normalize URLs (remove trailing slashes)
2. **Version Strings**: Use correct API versions (e.g., "v1.3" for Query API)
3. **UUID Format**: NMOS uses lowercase UUIDs
4. **TAI Timestamps**: IS-07 requires TAI (not UTC) timestamps
5. **SDP Format**: Validate SDP structure for IS-05 connections
6. **MQTT Topic Format**: Follow exact NMOS topic structure
7. **Credentials**: Handle authentication tokens securely via credentials API

## File Locations

- **Nodes**: `/nodes/*.js` and `/nodes/*.html`
- **Examples**: `/examples/*.json` - Flow examples for users
- **Configuration**: `package.json` - Node-RED node registration
- **Documentation**: `README.md` - User-facing documentation

## Development Workflow

1. No automated tests currently exist
2. No build step required (pure JavaScript)
3. No linting configuration (consider adding if making significant changes)
4. Manual testing with Node-RED runtime recommended

## Contributing Guidelines

When modifying or adding nodes:
1. Follow existing node patterns (see nmos-query.js as reference)
2. Include both .js and .html files
3. Add examples in `/examples` directory if adding new nodes
4. Update README.md with new features
5. Maintain backward compatibility with existing flows
6. Document all configuration options in HTML help text
7. Use appropriate node categories in HTML registration

## Dependencies Management

- Keep dependencies minimal and up-to-date
- Verify compatibility with Node-RED runtime
- Check for security vulnerabilities in dependencies
- Document any peer dependency requirements

## Resources

- [AMWA NMOS Specifications](https://specs.amwa.tv/nmos/)
- [Node-RED Node Development](https://nodered.org/docs/creating-nodes/)
- [IS-04 Discovery & Registration](https://specs.amwa.tv/is-04/)
- [IS-05 Device Connection Management](https://specs.amwa.tv/is-05/)
- [IS-07 Event & Tally](https://specs.amwa.tv/is-07/)
- [IS-12 Control Protocol](https://specs.amwa.tv/is-12/)

## Authentication

The `nmos-config` node supports three authentication methods:
1. **No Auth**: Direct access to registry
2. **Basic Auth**: Username and password
3. **Bearer Token**: OAuth/API token

Access credentials via: `registry.credentials.username`, `registry.credentials.password`, `registry.credentials.token`

## Important Notes for AI Assistants

- This is a specialized broadcast/media protocol implementation
- NMOS specifications are strict - follow them precisely
- Node-RED patterns are specific - don't use generic Node.js patterns
- WebSocket and MQTT must handle reconnection robustly
- Timing and synchronization are critical in broadcast environments
- Always validate against NMOS specification documents when in doubt

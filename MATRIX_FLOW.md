# NMOS Dynamic Matrix Flow Documentation

This document provides detailed information about the NMOS Dynamic Matrix Flow, a modular routing matrix implementation for Node-RED.

## Overview

The NMOS Dynamic Matrix Flow replaces the previous integrated dashboard widget with a flexible, flow-based approach that separates concerns and provides multiple integration options.

## Architecture

The flow is organized into seven main sections:

### 1. Query NMOS Resources

**Purpose**: Continuously fetch sender and receiver resources from the NMOS registry.

**Components**:
- **Inject Nodes**: Poll every 5 seconds (configurable)
- **nmos-query Nodes**: Query IS-04 registry for resources
- **Automatic Discovery**: Keeps device list updated

**Configuration**:
```javascript
// Polling interval in inject nodes
repeat: "5"  // seconds

// Query parameters
resourceType: "senders" | "receivers"
filter: ""   // Optional RQL filter
```

### 2. Process & Store Data

**Purpose**: Transform raw NMOS data and extract connection information.

**Components**:
- **Process Senders Function**: Transforms sender data for matrix display
- **Process Receivers Function**: Transforms receiver data and extracts subscriptions
- **Merge & Extract Connections**: Combines data and identifies active connections

**Data Flow**:
1. Raw NMOS resources → Transform to display format
2. Sort by label for better UX
3. Store in flow context (accessible by UI)
4. Extract active connections from receiver subscriptions

**Output Format**:
```javascript
{
  senders: [
    {
      id: "uuid",
      label: "Sender Name",
      description: "...",
      flow_id: "uuid",
      device_id: "uuid"
    }
  ],
  receivers: [
    {
      id: "uuid",
      label: "Receiver Name",
      description: "...",
      device_id: "uuid",
      subscription: {...}
    }
  ],
  connections: [
    {
      receiverId: "uuid",
      receiverLabel: "Receiver Name",
      senderId: "uuid",
      senderLabel: "Sender Name"
    }
  ],
  timestamp: "2025-11-02T10:00:00.000Z"
}
```

### 3. Matrix UI Endpoints

**Purpose**: Serve the web interface and provide data API.

**Endpoints**:

#### `GET /nmos-matrix`
Serves the Vue.js-based matrix interface.

**Features**:
- Responsive grid layout
- Search/filter by sender or receiver name
- Click crosspoints to connect/disconnect
- Real-time status display
- Auto-refresh every 10 seconds

**Technology Stack**:
- Vue 3 (loaded from CDN)
- Vanilla CSS (no dependencies)
- Fetch API for HTTP requests

#### `GET /nmos-matrix/data`
Returns current matrix data as JSON.

**Response**:
```json
{
  "senders": [...],
  "receivers": [...],
  "connections": [...],
  "timestamp": "2025-11-02T10:00:00.000Z"
}
```

**Use Cases**:
- Matrix UI data loading
- External integrations
- Monitoring and automation
- Snapshot comparison

### 4. Routing Operations (IS-05)

**Purpose**: Handle routing requests and execute IS-05 connection operations.

**Endpoint**:

#### `POST /nmos-matrix/route`
Execute a routing operation.

**Request Body**:
```json
{
  "receiverId": "receiver-uuid",
  "senderId": "sender-uuid",  // null for disconnect
  "operation": "activate"     // "activate" or "disconnect"
}
```

**Response**:
```json
{
  "success": true,
  "operation": "activate",
  "receiverId": "receiver-uuid",
  "senderId": "sender-uuid",
  "result": {...}  // IS-05 response
}
```

**Flow**:
1. Parse HTTP request
2. Extract routing parameters
3. Pass to `nmos-connection` node
4. Execute IS-05 connection workflow
5. Return result to client

**Error Handling**:
- Invalid receiver ID → 400 Bad Request
- Connection failure → 500 Internal Server Error
- NMOS registry unavailable → 503 Service Unavailable

### 5. WebSocket Updates (Optional)

**Purpose**: Subscribe to real-time resource changes for live updates.

**Components**:
- **nmos-websocket Nodes**: Subscribe to sender/receiver changes
- **Handle Change Functions**: Process add/modify/remove events
- **Dynamic Updates**: Automatic flow context updates

**Events**:
- `added`: New resource discovered
- `modified`: Resource properties updated
- `removed`: Resource no longer available

**Benefits**:
- Reduced polling overhead
- Instant UI updates
- Lower network traffic
- Better scalability

### 6. Snapshot Management

**Purpose**: Save, export, import, and apply routing configuration snapshots.

**Components**:
- **Save Snapshot**: Captures current routing state with metadata
- **Export Snapshot**: Downloads routing configuration as JSON file
- **Import Snapshot**: Uploads and validates snapshot JSON
- **Apply Snapshot**: Restores routing configuration from snapshot

**Snapshot Format**:
```json
{
  "version": "1.0",
  "timestamp": "2025-11-02T13:44:30Z",
  "name": "Production Setup 1",
  "description": "Main routing configuration",
  "routes": [
    {
      "sender_id": "sender-uuid",
      "receiver_id": "receiver-uuid",
      "sender_label": "Camera 1",
      "receiver_label": "Monitor A",
      "transport_params": {}
    }
  ]
}
```

**Features**:
- **Metadata**: Name, description, and timestamp for each snapshot
- **Validation**: Checks for missing or changed endpoints before applying
- **Preview**: Shows routing changes before applying snapshot
- **Graceful Handling**: Skips invalid routes while applying valid ones
- **Change Detection**: Identifies new connections, disconnections, and route changes

**Endpoints**:

#### `POST /nmos-matrix/snapshot/save`
Save current routing configuration as a snapshot.

**Request Body**:
```json
{
  "name": "Snapshot Name",
  "description": "Optional description"
}
```

**Response**:
```json
{
  "success": true,
  "snapshot": { /* snapshot object */ },
  "snapshotKey": "snapshot_1234567890"
}
```

#### `GET /nmos-matrix/snapshot/export`
Export current routing configuration as downloadable JSON file.

**Response**: JSON file download with routing configuration

#### `POST /nmos-matrix/snapshot/import`
Import and validate a snapshot JSON file.

**Request Body**: Snapshot JSON object

**Response**:
```json
{
  "valid": true,
  "snapshot": { /* metadata */ },
  "validation": {
    "validRoutes": 10,
    "invalidRoutes": 2,
    "changes": 5
  },
  "invalidRoutes": [ /* array of invalid routes with reasons */ ],
  "changes": [ /* array of routing changes */ ]
}
```

#### `POST /nmos-matrix/snapshot/apply`
Apply a previously imported and validated snapshot.

**Response**:
```json
{
  "success": true,
  "message": "Applying snapshot routes",
  "totalRoutes": 10,
  "changes": [ /* array of changes */ ]
}
```

**Workflow**:
1. User clicks "Save Snapshot" in UI
2. Enter name and description in modal dialog
3. Current routing is saved with metadata
4. To export, click "Export" button to download JSON file
5. To restore, click "Import" and select JSON file
6. Preview shows validation results and routing changes
7. Click "Apply Snapshot" to restore routing configuration
8. System applies routes sequentially with IS-05

### 7. nmos_crosspoint Integration (Optional)

**Purpose**: Integrate with the standalone nmos_crosspoint application.

See "Integration Options" below for details.

## Installation

### Requirements
- Node-RED v1.0.0 or higher
- NMOS IS-04 registry (Query API)
- NMOS IS-05 Connection API endpoints

### Import Flow

1. Open Node-RED editor
2. Go to Menu → Import
3. Select `examples/dynamic-matrix-flow.json`
4. Click Import
5. Configure registry settings
6. Deploy

### Configuration

#### NMOS Registry
Edit the `nmos-config` node:
- **Query URL**: `http://your-registry:3211`
- **Connection URL**: `http://your-registry:3212`
- **Authentication**: Optional username/password

#### Polling Interval
Edit the inject nodes:
- Default: 5 seconds
- Recommended: 5-30 seconds
- High-frequency: 1-2 seconds (higher load)

#### UI Port
The flow uses Node-RED's default HTTP port (1880).
Access at: `http://localhost:1880/nmos-matrix`

## Usage

### Basic Routing

1. Open the matrix UI in your browser
2. Use search boxes to filter senders/receivers
3. Click an empty crosspoint to connect
4. Click an active (teal) crosspoint to disconnect

### Programmatic Routing

Send HTTP POST requests to the routing endpoint:

```bash
curl -X POST http://localhost:1880/nmos-matrix/route \
  -H "Content-Type: application/json" \
  -d '{
    "receiverId": "receiver-uuid",
    "senderId": "sender-uuid",
    "operation": "activate"
  }'
```

### Monitoring

Query the data endpoint:

```bash
curl http://localhost:1880/nmos-matrix/data | jq
```

### Snapshot Management

#### Save Current Routing
1. Click "💾 Save Snapshot" button in the matrix UI
2. Enter a descriptive name (e.g., "Production Setup 1")
3. Optionally add a description
4. Click "Save Snapshot"
5. Snapshot is stored in Node-RED flow context

#### Export Snapshot
1. Click "⬇️ Export" button
2. Current routing configuration downloads as JSON file
3. File name: `nmos-routing-snapshot-[timestamp].json`
4. Save to desired location for backup or sharing

#### Import and Apply Snapshot
1. Click "⬆️ Import" button
2. Select a snapshot JSON file
3. Preview modal shows:
   - Snapshot metadata (name, description, timestamp)
   - Validation results (valid/invalid routes)
   - Routing changes (add/remove/change)
4. Review invalid routes (will be skipped)
5. Review routing changes to be applied
6. Click "Apply Snapshot" to restore routing
7. Wait for operations to complete (progress shown in UI)

#### Programmatic Snapshot Operations

**Save snapshot**:
```bash
curl -X POST http://localhost:1880/nmos-matrix/snapshot/save \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Live Show Setup",
    "description": "Configuration for main broadcast"
  }'
```

**Export snapshot**:
```bash
curl http://localhost:1880/nmos-matrix/snapshot/export \
  -o routing-backup.json
```

**Import and validate snapshot**:
```bash
curl -X POST http://localhost:1880/nmos-matrix/snapshot/import \
  -H "Content-Type: application/json" \
  -d @routing-backup.json
```

**Apply snapshot**:
```bash
curl -X POST http://localhost:1880/nmos-matrix/snapshot/apply \
  -H "Content-Type: application/json"
```

### Filtering

Add RQL filters to query nodes:
```javascript
// Filter by device
msg.filter = "device_id='device-uuid'";

// Filter by label
msg.filter = "label='Camera%'";  // Wildcard

// Combined filters
msg.filter = "device_id='device-uuid'&label='Camera%'";
```

## Integration Options

### Option 1: Native Flow (Default)

The provided flow is self-contained and requires no external dependencies.

**Pros**:
- Simple deployment
- Full control over UI/UX
- No additional services
- Direct NMOS integration

**Cons**:
- Basic UI (can be enhanced)
- Manual feature development

**Best For**:
- Quick deployment
- Custom workflows
- Embedded systems
- Learning NMOS

### Option 2: nmos_crosspoint Integration

Integrate with the [DHPKE/nmos_crosspoint](https://github.com/DHPKE/nmos_crosspoint) application for advanced features.

#### Setup

1. Clone and install nmos_crosspoint:
```bash
git clone https://github.com/DHPKE/nmos_crosspoint
cd nmos_crosspoint
npm install
```

2. Configure crosspoint registry URL:
```bash
# Edit configuration file
nano config.json
```

3. Start the crosspoint server:
```bash
npm start
```

4. Modify the flow:

**Method A: iFrame Integration**
Replace the `serve-matrix-ui` template node content with:
```html
<!DOCTYPE html>
<html>
<head>
    <title>NMOS Crosspoint</title>
    <style>
        body { margin: 0; padding: 0; }
        iframe { width: 100%; height: 100vh; border: none; }
    </style>
</head>
<body>
    <iframe src="http://localhost:3000"></iframe>
</body>
</html>
```

**Method B: Proxy Integration**
1. Keep existing query/connection nodes
2. Add HTTP proxy nodes to forward to crosspoint API
3. Use crosspoint UI with Node-RED backend

#### Features
- Advanced matrix visualization
- Multi-select routing
- Routing presets/snapshots
- Salvo operations
- Advanced filtering
- Connection history

**Pros**:
- Professional UI
- Advanced features
- Active development
- Community support

**Cons**:
- Additional service to manage
- More complex deployment
- Potential version conflicts

**Best For**:
- Production deployments
- Large installations
- Advanced routing workflows
- Professional broadcast

## Customization

### UI Styling

Edit the CSS in the `serve-matrix-ui` template node:

```css
/* Colors */
:root {
  --primary: #3FADB5;
  --bg-dark: #1a1a1a;
  --bg-medium: #2a2a2a;
}

/* Crosspoint size */
.crosspoint {
  width: 50px;
  height: 50px;
}

/* Active connection color */
.crosspoint.active {
  background: linear-gradient(135deg, #3FADB5 0%, #2d8a91 100%);
}
```

### Polling Frequency

Adjust inject node intervals based on your needs:
- **Real-time**: 1-2 seconds (high load)
- **Default**: 5 seconds (balanced)
- **Low-frequency**: 30-60 seconds (low load)

### Data Processing

Modify function nodes to:
- Add custom labels
- Filter specific devices
- Calculate statistics
- Add metadata
- Custom sorting

Example - Add device name to label:
```javascript
const senders = msg.payload.map(s => ({
    id: s.id,
    label: `${s.label} [${s.device_id.substring(0,8)}]`,
    // ... rest of fields
}));
```

### Error Handling

Add error handling nodes:
```javascript
// In process functions
try {
    // ... processing code
} catch (error) {
    node.error("Processing failed: " + error.message, msg);
    return null;
}
```

## Performance

### Optimization Tips

1. **Limit Query Results**
   - Use filters to reduce dataset
   - Implement pagination for large systems

2. **Adjust Polling**
   - Balance freshness vs load
   - Use WebSocket for real-time needs

3. **Cache Data**
   - Store in flow context
   - Reduce redundant queries

4. **Filter Early**
   - Apply filters at query level
   - Process less data

### Scalability

**Small Systems** (< 50 devices):
- Polling: 5 seconds
- No special optimization needed

**Medium Systems** (50-200 devices):
- Polling: 10 seconds
- Consider WebSocket for updates
- Implement search/filter

**Large Systems** (> 200 devices):
- Polling: 30 seconds
- Use WebSocket exclusively
- Implement pagination
- Consider dedicated server

## Troubleshooting

### No Senders/Receivers Displayed

**Possible Causes**:
1. Registry URL incorrect
2. Registry not running
3. Network connectivity issue
4. Authentication failure

**Solutions**:
- Check `nmos-config` node settings
- Verify registry is accessible: `curl http://registry:3211/x-nmos/query/v1.3/senders`
- Check Node-RED logs for errors
- Test authentication credentials

### Routing Failed

**Possible Causes**:
1. IS-05 Connection API unavailable
2. Receiver not routable
3. Sender incompatible with receiver
4. Network timeout

**Solutions**:
- Verify Connection API URL in config
- Check receiver supports IS-05
- Verify transport compatibility
- Increase timeout values

### UI Not Loading

**Possible Causes**:
1. Flow not deployed
2. Port conflict
3. Browser cache issue
4. JavaScript error

**Solutions**:
- Deploy the flow
- Check Node-RED is running
- Clear browser cache
- Check browser console for errors

### Connection State Out of Sync

**Possible Causes**:
1. Query polling too slow
2. WebSocket not connected
3. Registry cache issue

**Solutions**:
- Increase polling frequency
- Enable WebSocket subscriptions
- Click refresh in UI
- Restart registry

## API Reference

### Flow Context Variables

```javascript
// Get matrix data
const matrixData = flow.get('matrixData');

// Get senders only
const senders = flow.get('senders');

// Get receivers only
const receivers = flow.get('receivers');
```

### Message Properties

**Query Output**:
```javascript
msg.payload = [...];           // Array of resources
msg.resourceType = "senders";  // Resource type
```

**Routing Input**:
```javascript
msg.receiverId = "uuid";
msg.senderId = "uuid" | null;
msg.operation = "activate" | "disconnect";
```

**WebSocket Output**:
```javascript
msg.payload = {...};       // Resource data
msg.event = "added" | "modified" | "removed";
```

## Security Considerations

### Network Security
- Use HTTPS for production deployments
- Implement authentication on endpoints
- Restrict access by IP/network
- Use VPN for remote access

### NMOS Registry
- Secure registry with authentication
- Use TLS for IS-04/IS-05 connections
- Implement rate limiting
- Monitor for suspicious activity

### Node-RED
- Enable authentication
- Use HTTPS admin interface
- Keep Node-RED updated
- Review installed nodes

## Examples

### Example 1: Automated Routing

Add a function node to automatically route based on labels:

```javascript
const senders = flow.get('senders') || [];
const receivers = flow.get('receivers') || [];

// Auto-route based on matching labels
receivers.forEach(receiver => {
    const matchingSender = senders.find(s => 
        s.label.toLowerCase().includes(receiver.label.toLowerCase())
    );
    
    if (matchingSender) {
        msg.receiverId = receiver.id;
        msg.senderId = matchingSender.id;
        msg.operation = 'activate';
        node.send(msg);
    }
});
```

### Example 2: Routing Snapshot

Save current routing state:

```javascript
const matrixData = flow.get('matrixData');
const snapshot = {
    timestamp: new Date().toISOString(),
    connections: matrixData.connections
};

// Store snapshot
flow.set('routingSnapshot', snapshot);

// Or export to file
const fs = require('fs');
fs.writeFileSync('/tmp/routing-snapshot.json', JSON.stringify(snapshot, null, 2));
```

### Example 3: Batch Routing

Route multiple connections:

```javascript
const routes = [
    { receiverId: "receiver-1", senderId: "sender-1" },
    { receiverId: "receiver-2", senderId: "sender-2" },
    { receiverId: "receiver-3", senderId: "sender-3" }
];

routes.forEach(route => {
    const msg = {
        receiverId: route.receiverId,
        senderId: route.senderId,
        operation: 'activate'
    };
    node.send(msg);
});
```

## Migration from Old Matrix Node

If you previously used the `nmos-matrix-ui` dashboard widget:

1. **Export Current Settings**
   - Note your registry configuration
   - Document active connections

2. **Import New Flow**
   - Import `dynamic-matrix-flow.json`
   - Configure registry with same settings

3. **Test Routing**
   - Verify senders/receivers load
   - Test connect/disconnect operations

4. **Update Workflows**
   - Replace dashboard widget references
   - Update automation scripts to use new API

5. **Remove Old Widget**
   - Delete old `nmos-matrix-ui` nodes
   - Clean up dashboard configuration

## Contributing

To contribute improvements to the matrix flow:

1. Fork the repository
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## Support

For issues or questions:
- GitHub Issues: https://github.com/DHPKE/node-red-contrib-nmos-client/issues
- NMOS Specification: https://specs.amwa.tv/nmos

## License

Apache 2.0 - See LICENSE file for details.

# NMOS Matrix Node - Complete Guide

## Overview

The `nmos-matrix` node is a self-contained NMOS routing matrix implementation for Node-RED that replaces the previous flow-based approach with a single, draggable node. It provides complete routing matrix functionality with FlowFuse Dashboard integration support.

## Key Features

✅ **Drag-and-Drop**: Single node in the Node-RED palette (NMOS category)  
✅ **Auto-Discovery**: Automatic polling of IS-04 registry for senders and receivers  
✅ **IS-05 Routing**: Full connection management with activate/disconnect operations  
✅ **Snapshot Management**: Save, export, import, and restore routing configurations  
✅ **Message Control**: Programmatic control via input messages  
✅ **Event Output**: Real-time status updates and routing events  
✅ **FlowFuse Dashboard**: Vue component for visual matrix interface  
✅ **Multi-Instance**: Multiple matrix nodes can coexist in one flow  

## Installation

The node is included in `node-red-contrib-nmos-client` version 2.4.4 and above:

```bash
npm install node-red-contrib-nmos-client
```

After installation, the `nmos-matrix` node will appear in the NMOS category of the Node-RED palette.

## Quick Start

### Basic Setup

1. **Drag** the `nmos-matrix` node from the palette into your flow
2. **Double-click** to open configuration
3. **Select** an `nmos-config` node (or create one) with your NMOS registry URL
4. **Configure** refresh interval and display options
5. **Deploy** the flow
6. **Send messages** to control the matrix or monitor output events

### Example Flow

Import `examples/nmos-matrix-node-example.json` to see a complete working example with:
- Inject nodes for common commands
- Debug node for event monitoring
- Sample routing operations

## Configuration

### Connection Tab

#### NMOS Registry (Required)
Select or create an `nmos-config` node that defines:
- Query API URL (e.g., `http://registry:3211`)
- Connection API URL (e.g., `http://registry:3212`)
- Authentication credentials (if required)

#### Auto Refresh
- **Enabled**: Automatically polls registry for updates
- **Disabled**: Manual refresh only via input messages
- **Default**: Enabled

#### Refresh Interval
- **Range**: 1000-60000 ms (1-60 seconds)
- **Default**: 5000 ms (5 seconds)
- **Recommendation**: 
  - Small systems (< 50 endpoints): 5 seconds
  - Medium systems (50-200 endpoints): 10 seconds
  - Large systems (> 200 endpoints): 30 seconds

#### Connection Timeout
- **Range**: 1000+ ms
- **Default**: 30000 ms (30 seconds)
- **Purpose**: Maximum time to wait for IS-05 operations

#### Retry Attempts
- **Range**: 0-10
- **Default**: 3
- **Purpose**: Number of retry attempts for failed connections

### Display Tab

#### UI Style
- **Options**: NMOS Standard, Dante Controller Style
- **Default**: Dante Controller Style
- **NMOS Standard**: Traditional matrix view with basic controls
- **Dante Controller Style**: Professional Dante-inspired interface with advanced features

#### Compact View
- Smaller grid cells for large matrices
- Useful when displaying 100+ endpoints
- **Default**: Disabled

#### Show Labels
- Display sender/receiver labels (vs. numeric IDs)
- **Default**: Enabled

#### Color Scheme
- **Options**: default, dark, light, highcontrast
- **Default**: default

#### Show Audio Meters
- Display audio level meters in the UI
- **Note**: UI only, requires backend support for actual meter data
- **Default**: Disabled

#### Confirm Routes
- Show confirmation dialog before routing operations
- Prevents accidental route changes
- **Default**: Enabled

#### Lock Routes by Default
- Start with routes locked to prevent changes
- User can unlock via UI
- **Default**: Disabled

### Advanced Tab

View documentation for input message formats and output events.

## Input Messages

Control the matrix node by sending messages with `msg.payload.action`:

### Refresh Endpoints

Manually trigger a refresh of senders and receivers:

```javascript
msg.payload = {
    action: "refresh"
};
return msg;
```

### Create Route

Connect a sender to a receiver:

```javascript
msg.payload = {
    action: "route",
    sender_id: "550e8400-e29b-41d4-a716-446655440000",
    receiver_id: "650e8400-e29b-41d4-a716-446655440001"
};
return msg;
```

### Disconnect Route

Disconnect a receiver from its current sender:

```javascript
msg.payload = {
    action: "disconnect",
    receiver_id: "650e8400-e29b-41d4-a716-446655440001"
};
return msg;
```

### Save Snapshot

Save the current routing configuration:

```javascript
msg.payload = {
    action: "save_snapshot",
    name: "Production Setup 1",
    description: "Main routing configuration for live broadcast"
};
return msg;
```

### Load Snapshot

Apply a routing configuration from a snapshot:

```javascript
msg.payload = {
    action: "load_snapshot",
    snapshot: {
        version: "1.0",
        timestamp: "2025-11-02T14:25:35Z",
        name: "Production Setup 1",
        routes: [
            {
                sender_id: "550e8400-e29b-41d4-a716-446655440000",
                receiver_id: "650e8400-e29b-41d4-a716-446655440001",
                sender_label: "Camera 1",
                receiver_label: "Monitor A"
            }
        ]
    }
};
return msg;
```

### Get Current State

Retrieve current senders, receivers, and routes:

```javascript
msg.payload = {
    action: "get_state"
};
return msg;
```

## Output Messages

The node sends status updates and events:

### Route Changed

Sent when a route is created or removed:

```javascript
{
    payload: {
        event: "route_changed",
        sender_id: "550e8400-e29b-41d4-a716-446655440000",
        receiver_id: "650e8400-e29b-41d4-a716-446655440001",
        status: "connected" // or "disconnected"
    }
}
```

### Snapshot Saved

Sent when a snapshot is successfully saved:

```javascript
{
    payload: {
        event: "snapshot_saved",
        snapshot: { /* snapshot object */ },
        timestamp: "2025-11-02T14:25:35Z"
    }
}
```

### Snapshot Loaded

Sent when a snapshot is applied:

```javascript
{
    payload: {
        event: "snapshot_loaded",
        result: {
            success: true,
            validRoutes: 10,
            invalidRoutes: 2,
            applied: 9,
            failed: 1,
            invalidRoutes: [/* details */]
        }
    }
}
```

### Refreshed

Sent after endpoints are refreshed:

```javascript
{
    payload: {
        event: "refreshed",
        senders: 25,
        receivers: 15
    }
}
```

### State

Sent in response to `get_state` action:

```javascript
{
    payload: {
        event: "state",
        senders: [/* sender objects */],
        receivers: [/* receiver objects */],
        routes: {
            "receiver-id": "sender-id"
        }
    }
}
```

### Error

Sent when an operation fails:

```javascript
{
    payload: {
        event: "error",
        message: "Connection failed: timeout"
    }
}
```

## FlowFuse Dashboard Integration

### Prerequisites

Install FlowFuse Dashboard:

```bash
npm install @flowfuse/node-red-dashboard
```

### Using the Vue Component

The `ui/nmos-matrix.vue` component provides a complete matrix interface:

1. **Add UI Template Node**: Add a `ui-template` node to your dashboard
2. **Import Component**: Copy the contents of `ui/nmos-matrix.vue`
3. **Configure**: Set the `nodeId` prop to match your matrix node ID
4. **Deploy**: The matrix UI will appear in the dashboard

### Component Props

**NMOS Standard Component** (`ui/nmos-matrix.vue`):
```vue
<nmos-matrix
  :node-id="'your-matrix-node-id'"
  :compact-view="false"
  :show-labels="true"
  :color-scheme="'default'"
/>
```

**Dante Controller Style Component** (`ui/nmos-matrix-dante.vue`):
```vue
<nmos-matrix-dante
  :node-id="'your-matrix-node-id'"
  :ui-style="'dante'"
  :show-meters="true"
  :confirm-routes="true"
  :compact-view="false"
  :matrix-name="'Audio Routing Matrix'"
/>
```

### Matrix UI Features (NMOS Standard)

- **Grid Layout**: Senders as columns, receivers as rows
- **Click to Route**: Click any cell to connect/disconnect
- **Visual Indicators**:
  - ✅ Green: Active connection
  - ⭕ Gray: No connection
  - 🔄 Yellow: Pending operation
  - ❌ Red: Error state
- **Search/Filter**: Filter senders and receivers by name
- **Auto-Refresh**: Updates every 10 seconds
- **Snapshot Tools**: Save, export, import, and apply snapshots
- **Tooltips**: Hover for endpoint details

## Dante Controller Style UI

### Overview

The Dante Controller Style UI (`ui/nmos-matrix-dante.vue`) provides a professional, Dante Controller-inspired interface with advanced routing features. This UI is designed for broadcast and production environments requiring polished, production-ready controls.

### Key Features

#### Dual View Modes

**Grid View** (Crosspoint Matrix)
- Traditional crosspoint matrix layout
- Click-to-route functionality
- Visual connection indicators with color coding
- Row/column highlighting on hover
- Device name display on headers
- Compact mode for large installations

**List View** (Dropdown-Based Routing)
- Receiver list with dropdown sender selection
- Status badges showing connection state
- Quick disconnect buttons
- Search filtering
- Device icons for visual identification
- Ideal for quick routing changes

#### Dante-Inspired Styling

- **Dark Toolbar**: Professional gradient toolbar with clear visual hierarchy
- **Status Panel**: Real-time metrics dashboard
- **Clean Grid**: Organized crosspoint matrix with clear visual indicators
- **Color-Coded Cells**:
  - Green: Connected routes
  - Blue hover: Available routes
  - Orange: Pending operations
  - Gray: Inactive crosspoints

#### Device Selector

- Filter channels by device for better organization
- Automatically extracts device information from endpoints
- "All Devices" option to view complete matrix
- Device dropdown in toolbar for quick access
- Maintains routing state across device switches

#### Route Management

**Route Locking**
- Lock/unlock routes to prevent accidental changes
- Visual lock indicator in toolbar (🔒/🔓)
- Locked state prevents all routing operations
- Toast notification on lock state change
- Persists across view switches

**Confirmation Dialogs**
- Optional confirmation before routing operations
- Shows source and destination details
- Displays route type: connect, disconnect, or change
- Cancel or confirm options
- Prevents accidental route changes

**Clear All Routes**
- Bulk disconnect all active routes
- Confirmation dialog with count display
- Sequential disconnection with progress
- Error handling for failed operations

#### Visual Indicators

**Connection Status**
- ● (Solid dot): Connected
- Empty cell: Available
- ⏳ (Hourglass): Pending operation
- Hover highlighting for active sender/receiver

**Status Panel Metrics**
- Devices: Total number of unique devices
- TX Channels: Total sender count (filtered by device)
- RX Channels: Total receiver count (filtered by device)
- Active Routes: Current connection count
- Avg Latency: Placeholder for future implementation

**Status Badges** (List View)
- Connected: Green badge with "Connected" text
- No Signal: Gray badge with "No Signal" text
- Visual device icons (📻) for receivers

#### Enhanced Features

**Search and Filter**
- Search receivers in list view
- Device-based filtering in both views
- Real-time search results
- Preserves filter state across view switches

**Toast Notifications**
- Success: ✅ Green border
- Error: ❌ Red border
- Warning: ⚠️ Orange border
- Info: ℹ️ Blue border
- Auto-dismiss after 3 seconds
- Click to dismiss manually

**Error Handling**
- Structured error messages from backend
- Connection retry UI with countdown
- Suggestions list for troubleshooting
- Debug mode for raw data inspection
- Graceful handling of network disconnections

**Snapshot Management**
- Save, export, and import snapshots
- Dropdown menu in toolbar
- File-based import with validation
- Snapshot metadata display
- Integration with backend snapshot API

### Configuration

Configure the Dante-style UI in the matrix node's Display tab:

1. **UI Style**: Select "Dante Controller Style"
2. **Show Audio Meters**: Enable to show meter placeholders
3. **Confirm Routes**: Enable confirmation dialogs
4. **Lock Routes by Default**: Start with routes locked
5. **Compact View**: Enable for large matrices

### Usage Example

```vue
<template>
  <div id="app">
    <nmos-matrix-dante
      :node-id="matrixNodeId"
      :ui-style="'dante'"
      :show-meters="true"
      :confirm-routes="true"
      :compact-view="false"
      :matrix-name="'Production Audio Matrix'"
    />
  </div>
</template>

<script>
import NmosMatrixDante from './ui/nmos-matrix-dante.vue';

export default {
  components: {
    NmosMatrixDante
  },
  data() {
    return {
      matrixNodeId: 'your-matrix-node-id'
    }
  }
}
</script>
```

### Component Props (Dante Style)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `nodeId` | String | Required | Node-RED matrix node ID |
| `uiStyle` | String | 'dante' | UI styling variant |
| `showMeters` | Boolean | false | Show audio level meters (UI only) |
| `confirmRoutes` | Boolean | true | Show confirmation dialogs |
| `compactView` | Boolean | false | Use compact grid cells |
| `matrixName` | String | '' | Display name in toolbar |

### Keyboard Shortcuts

- **Escape**: Close dialogs
- **Click outside**: Dismiss menus/dialogs

### Best Practices

1. **Use Device Filtering**: For installations with many devices, use device selector to focus on specific systems
2. **Enable Route Locking**: In production, lock routes to prevent accidental changes
3. **Enable Confirmations**: Always enable confirmation dialogs for critical systems
4. **List View for Quick Changes**: Use list view for quick single-route changes
5. **Grid View for Overview**: Use grid view to see entire routing matrix at a glance
6. **Regular Snapshots**: Save snapshots before making major routing changes

### Comparison: Standard vs Dante Style

| Feature | NMOS Standard | Dante Style |
|---------|--------------|-------------|
| Grid View | ✅ | ✅ |
| List View | ❌ | ✅ |
| Device Filtering | ❌ | ✅ |
| Route Locking | ❌ | ✅ |
| Confirmation Dialogs | ❌ | ✅ |
| Status Panel | Basic | Advanced |
| Visual Design | Standard | Dante-inspired |
| Toolbar | Basic | Professional |
| Bulk Operations | Limited | Clear All Routes |
| Hover Highlighting | ❌ | ✅ |

## Snapshot Management

### Snapshot Format

Snapshots are JSON files with the following structure:

```json
{
  "version": "1.0",
  "timestamp": "2025-11-02T14:25:35Z",
  "name": "Production Config",
  "description": "Main routing setup",
  "registry": "http://registry.local:3211",
  "routes": [
    {
      "sender_id": "550e8400-e29b-41d4-a716-446655440000",
      "sender_label": "Camera 1 Video",
      "receiver_id": "650e8400-e29b-41d4-a716-446655440001",
      "receiver_label": "Monitor A",
      "transport_params": {
        "type": "urn:x-nmos:transport:rtp"
      },
      "connected_at": "2025-11-02T14:20:00Z"
    }
  ]
}
```

### Snapshot Validation

When loading a snapshot, the node validates each route:

- ✅ **Valid**: Both sender and receiver exist in current registry
- ❌ **Invalid**: Sender or receiver not found (route skipped)

The node reports:
- Number of valid and invalid routes
- Routes that will be added
- Routes that will be changed
- Routes that will be removed

### Best Practices

1. **Descriptive Names**: Use clear snapshot names with dates
2. **Regular Backups**: Export snapshots before major changes
3. **Version Control**: Keep snapshots in source control
4. **Test First**: Test snapshot restore in non-production environment
5. **Review Preview**: Always review validation before applying

## Use Cases

### 1. Basic Routing Control

```
[Inject] --> [Matrix Node] --> [Debug]
```

Send routing commands via inject nodes, monitor events in debug.

### 2. Automated Daily Backup

```
[Inject (daily)] --> [Matrix Node] --> [Function] --> [File Write]
```

Save routing configuration daily:

```javascript
// In function node
msg.payload = {
    action: "save_snapshot",
    name: "Daily Backup " + new Date().toISOString().split('T')[0],
    description: "Automated daily backup"
};
return msg;
```

### 3. Event-Driven Routing

```
[MQTT In] --> [Function] --> [Matrix Node]
```

Route based on external events:

```javascript
// In function node
const event = JSON.parse(msg.payload);

if (event.type === "camera_active") {
    msg.payload = {
        action: "route",
        sender_id: event.camera_sender_id,
        receiver_id: event.preview_receiver_id
    };
    return msg;
}
```

### 4. Startup Configuration

```
[Inject (once)] --> [File Read] --> [JSON Parse] --> [Matrix Node]
```

Automatically restore routing on Node-RED startup:

```javascript
// In function node after file read
msg.payload = {
    action: "load_snapshot",
    snapshot: JSON.parse(msg.payload)
};
return msg;
```

## Node Status Indicators

The node displays its current state in the Node-RED editor:

- 🟡 **Initializing**: Node is starting up
- 🔵 **Refreshing**: Polling registry for updates
- 🟢 **25S/15R**: Ready (25 senders, 15 receivers)
- 🟡 **Routing...**: Executing a routing operation
- 🔴 **Error**: An error occurred
- 🔴 **No Config**: No registry configured
- 🔴 **Route Failed**: Last routing operation failed

## Comparison with Dynamic Matrix Flow

### Old Approach (Flow-Based)

- Multiple nodes (inject, query, function, template, http)
- Manual flow assembly required
- HTTP endpoints for custom UI
- Flexible but complex setup

### New Approach (Matrix Node)

- Single draggable node
- Pre-configured functionality
- Built-in Vue component
- Simple configuration panel
- Message-based control
- Event-based output

### Migration Path

1. Export routing from old flow's snapshot endpoint
2. Add `nmos-matrix` node to your flow
3. Configure with same registry settings
4. Import snapshot into new node
5. Update any automation to use new message format
6. Remove old matrix flow nodes

## Troubleshooting

### No Senders/Receivers Found

**Symptoms**: Node shows 0S/0R or red status

**Solutions**:
1. Check registry URL in `nmos-config` node
2. Verify registry is accessible: `curl http://registry:3211/x-nmos/query/v1.3/senders`
3. Check Node-RED logs for errors
4. Test authentication credentials if using auth
5. Ensure registry has registered devices

### Routing Operations Fail

**Symptoms**: Routes don't activate, red status shown

**Solutions**:
1. Verify receiver supports IS-05 (check device controls)
2. Increase connection timeout in node config
3. Check network connectivity to device
4. Review Node-RED logs for detailed error messages
5. Verify sender/receiver are compatible (same transport type)

### Snapshot Load Fails

**Symptoms**: All routes invalid when importing snapshot

**Solutions**:
1. Ensure endpoints exist in current registry
2. Verify sender/receiver IDs match exactly
3. Check snapshot format matches expected structure
4. Refresh endpoints before loading snapshot
5. Review validation preview for specific issues

### High CPU Usage

**Symptoms**: Node-RED consuming excessive CPU

**Solutions**:
1. Increase refresh interval (e.g., 10-30 seconds)
2. Disable auto-refresh, use manual refresh
3. Reduce number of matrix node instances
4. Check for registry connection issues causing retries

### HTTP Endpoint Not Responding

**Symptoms**: Vue component cannot connect to node

**Solutions**:
1. Verify Node-RED is running
2. Check node is deployed and active
3. Ensure node ID matches in Vue component
4. Check browser console for HTTP errors
5. Verify no firewall blocking requests

## Performance Recommendations

### Small Systems (< 50 endpoints)
- Refresh Interval: 5 seconds
- Connection Timeout: 30 seconds
- Auto-Refresh: Enabled

### Medium Systems (50-200 endpoints)
- Refresh Interval: 10 seconds
- Connection Timeout: 45 seconds
- Auto-Refresh: Enabled
- Consider: Compact view

### Large Systems (> 200 endpoints)
- Refresh Interval: 30 seconds
- Connection Timeout: 60 seconds
- Auto-Refresh: Optional (manual refresh may be better)
- Recommended: Compact view
- Consider: Filtering endpoints at registry level

## Security Considerations

### Network Security
- Use HTTPS in production
- Implement authentication on registry
- Restrict access by IP/network
- Use VPN for remote access

### Snapshot Security
- Treat snapshots as sensitive data
- Store in secure locations
- Implement access controls
- Consider encryption for storage
- Keep in version control

### NMOS Registry
- Secure registry with authentication
- Use TLS for IS-04/IS-05 connections
- Implement rate limiting
- Monitor for suspicious activity

## API Compatibility

- **NMOS IS-04**: v1.3 (Discovery and Registration)
- **NMOS IS-05**: v1.1 (Device Connection Management)
- **Node-RED**: v1.0.0 or higher
- **Node.js**: v14.0.0 or higher
- **FlowFuse Dashboard**: 2.x (for Vue component)

## Support and Resources

### Documentation
- Full docs: `docs/nmos-matrix.md`
- Example flow: `examples/nmos-matrix-node-example.json`
- Vue component: `ui/nmos-matrix.vue`

### External Resources
- [AMWA IS-04 Specification](https://specs.amwa.tv/is-04/)
- [AMWA IS-05 Specification](https://specs.amwa.tv/is-05/)
- [Node-RED Documentation](https://nodered.org/docs/)
- [FlowFuse Dashboard](https://dashboard.flowfuse.com/)

### Getting Help
- GitHub Issues: https://github.com/DHPKE/node-red-contrib-nmos-client/issues
- Repository: https://github.com/DHPKE/node-red-contrib-nmos-client

## License

Apache 2.0 - See LICENSE file for details.

## Contributing

Contributions welcome! Please submit pull requests with:
- Clear description of changes
- Test cases if applicable
- Documentation updates
- Examples if adding features

---

**Version**: 2.4.4  
**Last Updated**: 2025-11-02

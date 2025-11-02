# NMOS Matrix Node - Quick Start Guide

This guide helps you get started with the NMOS Matrix node in under 2 minutes.

## Quick Setup (Localhost)

If you have an NMOS registry running on `localhost:3211`, follow these steps:

1. **Add the NMOS Matrix Node**
   - Drag the `nmos-matrix` node from the palette to your flow

2. **Configure the Node**
   - Double-click the node to open configuration
   - In the **Connection** tab, enter Registry URL: `http://localhost:3211`
   - Click **Test Connection** to verify (optional)
   - Click **Done**

3. **Deploy**
   - Click the **Deploy** button in the top-right corner
   - The node should show a green dot with status like "15S/20R" (senders/receivers)

4. **Access the UI**
   - Add a FlowFuse Dashboard `ui-template` node
   - Use the Vue component from `ui/nmos-matrix.vue` or `ui/nmos-matrix-dante.vue`
   - The UI will automatically detect and connect to your matrix node

That's it! You now have a working NMOS routing matrix.

## Advanced Setup (Custom Registry)

For custom registry URLs or authentication:

### Option 1: Direct URL Configuration (Simple)

1. Add the NMOS Matrix node to your flow
2. Configure the Connection tab:
   - **Registry URL**: Enter your registry URL (e.g., `http://registry.example.com:8870`)
   - **API Version**: Select the appropriate version (default: v1.3)
   - **Test Connection**: Click to verify connectivity
3. Deploy your flow

### Option 2: NMOS Config Node (Advanced)

For shared configuration across multiple nodes or authentication:

1. Add the NMOS Matrix node to your flow
2. Create an `nmos-config` node:
   - Click the pencil icon next to "Config Node"
   - Click "Add new nmos-config..."
   - Configure registry URL, API version, and authentication
   - Click "Add"
3. Select the config node from the dropdown
4. Deploy your flow

## Vue UI Integration

### Auto-Detection (Easiest)

The Vue components now auto-detect matrix nodes automatically:

```vue
<template>
  <nmos-matrix />
</template>

<script>
import NmosMatrix from './ui/nmos-matrix.vue';

export default {
  components: { NmosMatrix }
}
</script>
```

If only one matrix node exists in your flow, it will be automatically detected and connected.

### Explicit Node ID (For Multiple Nodes)

If you have multiple matrix nodes, specify which one to connect to:

```vue
<template>
  <nmos-matrix :nodeId="matrixNodeId" />
</template>

<script>
import NmosMatrix from './ui/nmos-matrix.vue';

export default {
  components: { NmosMatrix },
  data() {
    return {
      matrixNodeId: 'abc123def456' // Your matrix node ID from Node-RED
    }
  }
}
</script>
```

## Configuration Options

### Connection Settings

- **Registry URL**: Direct URL to NMOS registry (e.g., `http://localhost:3211`)
- **API Version**: NMOS Query API version (v1.0, v1.1, v1.2, v1.3)
- **Config Node**: Alternative to direct URL, use shared `nmos-config` node
- **Auto Refresh**: Automatically poll for endpoint changes (default: enabled)
- **Refresh Interval**: How often to poll in milliseconds (default: 5000ms)
- **Connection Timeout**: Maximum time for IS-05 operations (default: 30000ms)
- **Retry Attempts**: Number of retries for failed operations (default: 3)

### Display Settings

- **UI Style**: Choose between "NMOS Standard" or "Dante Controller Style"
- **Compact View**: Reduce cell sizes for large matrices
- **Show Labels**: Display sender/receiver labels (vs. numbered grid)
- **Color Scheme**: default, dark, light, or highcontrast
- **Show Audio Meters**: Display audio level indicators (UI feature)
- **Confirm Routes**: Require confirmation before route changes
- **Lock Routes by Default**: Start with routes locked

## Common Configuration

### Local Development
```
Registry URL: http://localhost:3211
API Version: v1.3
Auto Refresh: ✓ enabled
Refresh Interval: 5000ms
```

### Production with Custom Registry
```
Registry URL: http://registry.production.local:8870
API Version: v1.3
Auto Refresh: ✓ enabled
Refresh Interval: 10000ms
Connection Timeout: 60000ms
```

### Shared Configuration (Multiple Nodes)
```
Use nmos-config node with:
- Registry URL: http://registry.internal:8870
- Authentication: Basic Auth or Token
- All matrix nodes reference the same config node
```

## Troubleshooting

### Node shows "not configured"
- **Solution**: Enter a Registry URL or select a Config Node

### Node shows "connection failed"
- **Check**: Registry is running and accessible
- **Check**: URL starts with `http://` or `https://`
- **Check**: Port number is correct (common: 3211, 8870)
- **Try**: Click "Test Connection" for detailed error

### UI shows "No Matrix Nodes Found"
- **Check**: Matrix node is deployed in Node-RED
- **Check**: Node-RED is running
- **Try**: Refresh the browser page

### UI shows "Multiple Matrix Nodes Detected"
- **Solution**: Specify `nodeId` prop in Vue component
- **Find IDs**: Check the error message for available node IDs

### No Endpoints Found
- **Check**: NMOS devices are running
- **Check**: Devices are registered with the same registry
- **Check**: Devices are on the same network

## Next Steps

- Explore **Snapshot Management** for saving/loading routing configurations
- Use **Input Messages** to control routing programmatically
- Check **Output Messages** for routing events and integration with other flows
- Review the full documentation in the node's help panel

## Support

For issues, questions, or contributions:
- GitHub: https://github.com/DHPKE/node-red-contrib-nmos-client
- Documentation: See node help panel in Node-RED editor

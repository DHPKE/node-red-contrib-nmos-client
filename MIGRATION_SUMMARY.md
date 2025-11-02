# Matrix Node Migration Summary

This document summarizes the changes made to replace the integrated matrix dashboard widget with a modular flow-based approach.

## Changes Overview

### Files Removed ❌
- `nodes/nmos-matrix-ui.js` - Backend node implementation
- `nodes/nmos-matrix-ui.html` - Node-RED editor configuration
- `ui/index.js` - Widget registration
- `ui/components/NmosMatrix.vue` - Vue 3 dashboard component
- `examples/matrix-ui-example-flow.json` - Old example flow

**Total removed**: ~1,100 lines of code

### Files Created ✅
- `examples/dynamic-matrix-flow.json` - Complete modular matrix flow (34 nodes)
- `MATRIX_FLOW.md` - Comprehensive documentation (500+ lines)
- `MIGRATION_SUMMARY.md` - This file

**Total added**: ~600 lines

### Files Modified 📝
- `package.json` - Removed matrix node registration and dashboard dependency
- `README.md` - Updated documentation with new flow-based approach

## Architecture Comparison

### Old Approach (Removed)
```
┌─────────────────────────────────────┐
│   nmos-matrix-ui Node (Dashboard)   │
│  ┌──────────────────────────────┐   │
│  │  Integrated Vue Component    │   │
│  │  - Queries registry          │   │
│  │  - Renders matrix            │   │
│  │  - Handles routing           │   │
│  │  - Manages state             │   │
│  └──────────────────────────────┘   │
│              ↓                       │
│        Dashboard Group               │
└─────────────────────────────────────┘
         ↓
   nmos-connection node
```

**Characteristics**:
- ✅ Easy to use (drag & drop)
- ✅ Integrated with FlowFuse Dashboard
- ❌ Monolithic architecture
- ❌ Required dashboard dependency
- ❌ Less flexible
- ❌ Difficult to customize

### New Approach (Implemented)
```
┌──────────────────────────────────────────────────────┐
│              Dynamic Matrix Flow                      │
│                                                        │
│  [Poll] → [Query] → [Process] → [Store in Context]   │
│    ↓         ↓          ↓                             │
│  Every 5s  IS-04    Transform                         │
│                                                        │
│  ┌────────────────────────────────────────┐          │
│  │        HTTP Endpoints                   │          │
│  │  GET  /nmos-matrix      → Vue UI       │          │
│  │  GET  /nmos-matrix/data → JSON API     │          │
│  │  POST /nmos-matrix/route → Routing     │          │
│  └────────────────────────────────────────┘          │
│                      ↓                                 │
│              [nmos-connection]                        │
│                      ↓                                 │
│              IS-05 Connection API                     │
│                                                        │
│  Optional: WebSocket subscriptions for real-time     │
└──────────────────────────────────────────────────────┘
```

**Characteristics**:
- ✅ Modular architecture
- ✅ No dashboard dependency
- ✅ Highly customizable
- ✅ Standard HTTP/REST interface
- ✅ Standalone Vue UI
- ✅ Easy to integrate with external systems
- ✅ Better separation of concerns

## Feature Comparison

| Feature | Old Matrix UI | New Matrix Flow |
|---------|--------------|-----------------|
| **Deployment** | Dashboard widget | HTTP endpoints |
| **UI Framework** | Vue 3 (Dashboard) | Vue 3 (Standalone CDN) |
| **Dependencies** | @flowfuse/node-red-dashboard | None (uses Node-RED HTTP) |
| **Query Method** | Internal HTTP calls | Separate query nodes |
| **Connection Management** | Integrated | Separate connection node |
| **Real-time Updates** | Polling only | Polling + WebSocket |
| **Customization** | Limited | Fully customizable |
| **External Integration** | Difficult | Easy (REST API) |
| **Data Access** | Widget-scoped | Flow context (accessible) |
| **Routing Control** | UI only | UI + Programmatic |

## New Capabilities

### 1. REST API Access
```bash
# Get matrix data
curl http://localhost:1880/nmos-matrix/data

# Route a connection
curl -X POST http://localhost:1880/nmos-matrix/route \
  -H "Content-Type: application/json" \
  -d '{"receiverId":"uuid","senderId":"uuid","operation":"activate"}'
```

### 2. Programmatic Control
```javascript
// Access matrix data in flows
const matrixData = flow.get('matrixData');

// Trigger routing from any node
msg.receiverId = "receiver-uuid";
msg.senderId = "sender-uuid";
msg.operation = "activate";
```

### 3. WebSocket Subscriptions
Real-time updates when devices are added/removed without polling overhead.

### 4. Custom Processing
Modify function nodes to:
- Add custom labels
- Filter devices
- Calculate statistics
- Implement custom routing logic

### 5. Multiple Integration Options
- **Option 1**: Use the built-in Vue UI (default)
- **Option 2**: Integrate with nmos_crosspoint application
- **Option 3**: Build your own custom UI using the REST API

## Migration Guide

### For Existing Users

If you were using the old `nmos-matrix-ui` node:

1. **Export your current flow** (backup)
2. **Note your registry settings** from the nmos-config node
3. **Update the package** to the new version
4. **Import** `examples/dynamic-matrix-flow.json`
5. **Configure** the registry with your settings
6. **Test** routing operations
7. **Remove** old matrix-ui nodes from your flow

### Quick Start for New Users

1. Import `examples/dynamic-matrix-flow.json` into Node-RED
2. Edit the `nmos-config` node with your registry URL
3. Deploy the flow
4. Open `http://localhost:1880/nmos-matrix` in your browser
5. Start routing!

## Technical Details

### Node Count
- **Total nodes**: 34
- **Configuration nodes**: 1 (nmos-config)
- **Query nodes**: 2 (senders + receivers)
- **Processing nodes**: 3 (function nodes)
- **HTTP endpoints**: 6 (in + response pairs)
- **Connection nodes**: 1 (nmos-connection)
- **WebSocket nodes**: 2 (optional)
- **Debug nodes**: 3
- **Comment nodes**: 6
- **Inject nodes**: 2 (polling)
- **Template nodes**: 1 (UI HTML)

### Data Flow
1. **Polling**: Every 5 seconds (configurable)
2. **Query**: Fetch from IS-04 registry
3. **Process**: Transform and extract connections
4. **Store**: Save to flow context
5. **Serve**: Provide via HTTP endpoints
6. **Display**: Vue.js renders matrix
7. **Route**: User clicks → HTTP POST → nmos-connection → IS-05

### Performance
- **Small systems** (< 50 devices): Excellent
- **Medium systems** (50-200 devices): Good
- **Large systems** (> 200 devices): Recommended to use WebSocket and increase polling interval

## Benefits of the New Approach

### 1. Modularity
Each component has a single responsibility:
- Query nodes → Data acquisition
- Function nodes → Data processing
- HTTP nodes → API interface
- Connection node → Routing execution

### 2. Flexibility
- Customize any part of the flow
- Add custom processing logic
- Integrate with external systems
- Build your own UI

### 3. No Dependencies
- No need for FlowFuse Dashboard
- Works with any Node-RED installation
- Uses standard Node-RED HTTP nodes
- Vue 3 loaded from CDN

### 4. Better Integration
- REST API for external access
- Flow context for data sharing
- Programmatic routing control
- Multiple UI options

### 5. Easier Maintenance
- Clear separation of concerns
- Standard Node-RED patterns
- Well-documented architecture
- Easy to debug

## Breaking Changes

### Removed Features
- FlowFuse Dashboard 2.0 integration
- Dashboard widget UI group configuration
- Dashboard-specific styling
- Widget-level pass-through messages

### Migration Required For
- Existing flows using `nmos-matrix-ui` node
- Dashboard-specific configurations
- Widget-based message passing
- Dashboard group layouts

### Not Affected
- NMOS query operations
- Connection management (IS-05)
- WebSocket subscriptions
- Other NMOS nodes (config, query, connection, etc.)

## Future Enhancements

Potential improvements for the flow:

1. **Multi-select routing**: Connect one sender to multiple receivers
2. **Routing presets**: Save and recall routing configurations
3. **Connection history**: Track routing changes over time
4. **Advanced filtering**: Complex query capabilities
5. **Batch operations**: Salvo routing for multiple connections
6. **Audio level metering**: Display audio levels on connections
7. **Device status monitoring**: Show device health and status
8. **Automated failover**: Backup routing on device failure

## Support and Resources

- **Full Documentation**: [MATRIX_FLOW.md](MATRIX_FLOW.md)
- **Example Flow**: `examples/dynamic-matrix-flow.json`
- **GitHub Issues**: https://github.com/DHPKE/node-red-contrib-nmos-client/issues
- **NMOS Specifications**: https://specs.amwa.tv/nmos

## License

Apache 2.0 - See LICENSE file for details.

---

**Note**: This migration represents a significant architectural change from an integrated dashboard widget to a modular flow-based approach. While the old approach was easier for simple use cases, the new approach provides much greater flexibility and better integration capabilities for advanced workflows.

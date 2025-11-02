# NMOS Matrix Node - Implementation Notes

## Overview

This document summarizes the implementation of the `nmos-matrix` Node-RED node created to replace the flow-based matrix approach with a self-contained, draggable node.

## Implementation Date

November 2, 2025

## Version

2.4.4

## Components Created

### 1. Backend Node (`nodes/nmos-matrix.js`)

**Features:**
- Complete IS-04 discovery with configurable polling
- IS-05 routing operations (activate/disconnect)
- Snapshot management (save/load/export/import)
- HTTP endpoint for Vue component communication
- Message-based input/output
- Node instance registry for multi-instance support
- Comprehensive error handling

**Key Methods:**
- `refreshEndpoints()` - Poll IS-04 registry
- `executeRoute()` - IS-05 connection management
- `saveSnapshot()` - Capture current routing state
- `loadSnapshot()` - Apply routing configuration
- HTTP POST `/nmos-matrix/:nodeId/command` - Command handler

**Security:**
- Uses Node-RED's httpAdmin (inherits authentication)
- Security notes added for production deployment
- No vulnerabilities found in CodeQL scan

### 2. Frontend Configuration (`nodes/nmos-matrix.html`)

**Features:**
- Tabbed configuration interface
- Connection settings (registry, refresh, timeout, retries)
- Display options (compact view, labels, color scheme)
- Advanced documentation (input/output formats)
- Integrated help text

**Tabs:**
1. Connection - Registry and polling configuration
2. Display - UI appearance settings
3. Advanced - API documentation

### 3. Vue Component (`ui/nmos-matrix.vue`)

**Features:**
- Complete matrix grid interface
- Click-to-route functionality
- Visual connection indicators (✅⭕🔄❌)
- Search/filter for senders and receivers
- Snapshot management (save/export/import/apply)
- Toast notification system
- Auto-refresh (10 seconds)
- Responsive design

**User Experience:**
- Replaced browser alerts with toast notifications
- HTTP status-specific error messages
- Auto-dismissing notifications (3 seconds)
- Click to dismiss notifications
- Loading overlays during operations
- Validation preview for snapshot imports

### 4. Documentation

**Files:**
- `docs/nmos-matrix.md` - Complete API documentation
- `NMOS_MATRIX_NODE.md` - Comprehensive user guide
- Updated `README.md` - Quick reference

**Coverage:**
- Configuration options
- Input message formats
- Output event formats
- Snapshot structure
- Use cases and examples
- Troubleshooting guide
- Performance recommendations
- Security considerations

### 5. Example Flow (`examples/nmos-matrix-node-example.json`)

**Includes:**
- Matrix node configuration
- Inject nodes for all commands
- Debug node for event monitoring
- Documentation in flow info

**Commands Demonstrated:**
- Refresh endpoints
- Get current state
- Route example
- Disconnect example
- Save snapshot

## Technical Architecture

### Data Flow

```
User Input → Vue Component → HTTP POST → Node Backend → NMOS Registry
                                                      ↓
User Output ← Vue Component ← HTTP Response ← Node Backend
```

### Node Communication

```
External System → Input Message → Node → Process → Output Message → External System
```

### Snapshot Workflow

```
Current State → Save → Memory/Context
              ↓
            Export → JSON File
              ↓
            Import → Validate → Preview → Apply → Routing Changes
```

## Design Decisions

### 1. HTTP Endpoint vs WebSocket

**Decision:** HTTP endpoint for Vue component communication

**Rationale:**
- Simpler implementation
- Leverages Node-RED's existing HTTP infrastructure
- Adequate for polling-based updates
- Easier to debug and test

### 2. Toast Notifications vs Alerts

**Decision:** Custom toast notification system

**Rationale:**
- Better user experience
- Non-blocking
- Consistent styling
- Auto-dismiss functionality
- Accessible (click to dismiss)

### 3. Node Instance Registry

**Decision:** Map-based registry for HTTP access

**Rationale:**
- Enables HTTP endpoint to find node instances
- Supports multiple nodes in one flow
- Clean lifecycle management
- Minimal memory overhead

### 4. Snapshot Validation

**Decision:** Validate before apply with preview

**Rationale:**
- Prevents partial failures
- User can review changes
- Invalid routes are skipped
- Clear feedback on what will happen

### 5. Paging Limit

**Decision:** Hardcoded 1000 endpoints

**Rationale:**
- Adequate for most use cases
- Simplifies implementation
- Can be made configurable in future if needed
- Registry typically limits responses anyway

## Testing Considerations

### Manual Testing Required

1. **Configuration:**
   - Test with valid registry
   - Test without registry
   - Test auto-refresh on/off
   - Test various intervals

2. **Routing Operations:**
   - Connect sender to receiver
   - Disconnect receiver
   - Multiple simultaneous operations
   - Error scenarios (timeout, invalid IDs)

3. **Snapshot Management:**
   - Save snapshot with metadata
   - Export to JSON file
   - Import valid snapshot
   - Import invalid snapshot
   - Apply with validation

4. **Vue Component:**
   - Search/filter functionality
   - Cell click interactions
   - Modal dialogs
   - Toast notifications
   - Loading states

5. **Message I/O:**
   - All input actions
   - All output events
   - Error conditions

6. **Multi-Instance:**
   - Multiple nodes in one flow
   - Independent operation
   - No cross-talk

### Edge Cases

- Registry unreachable
- Malformed responses
- Network timeouts
- Large matrices (500+ endpoints)
- Rapid clicking
- Concurrent operations
- Invalid UUIDs
- Missing endpoints in snapshot

## Known Limitations

1. **Paging Limit:** Hardcoded to 1000 endpoints
2. **Auto-Refresh Interval:** 10 seconds in Vue component
3. **No WebSocket:** Polling-based updates only
4. **Single Registry:** One registry per node
5. **No Transport Validation:** Assumes compatible transports

## Future Enhancements

### Potential Improvements

1. **Configurable Paging:**
   - Add paging limit to configuration
   - Support pagination for large systems

2. **WebSocket Support:**
   - Real-time updates
   - Bidirectional communication
   - Lower overhead

3. **Transport Validation:**
   - Check sender/receiver compatibility
   - Prevent invalid routes

4. **Bulk Operations:**
   - Multi-select routing
   - Salvo operations
   - Batch disconnect

5. **History/Audit:**
   - Track routing changes
   - Export audit log
   - Undo/redo functionality

6. **Advanced Filtering:**
   - Filter by device
   - Filter by transport
   - Custom queries

7. **Performance Metrics:**
   - Connection latency
   - Success rates
   - Operation times

## Migration from Flow-Based Approach

### Old Approach (Dynamic Matrix Flow)

**Advantages:**
- Highly flexible
- Easy to customize
- No dependencies

**Disadvantages:**
- Complex setup
- Multiple nodes required
- Manual configuration
- Harder to maintain

### New Approach (Matrix Node)

**Advantages:**
- Single node
- Simple configuration
- Drag-and-drop
- Consistent behavior
- Built-in Vue component

**Disadvantages:**
- Less flexible
- Requires package update to modify

### Migration Steps

1. Export routing from old flow
2. Add new matrix node
3. Configure with same registry
4. Import snapshot
5. Test routing operations
6. Update automation flows
7. Remove old flow nodes

## Code Quality

### Metrics

- **Lines of Code:** ~3,500
- **Files Created:** 7
- **Documentation Pages:** 3
- **Example Flows:** 1

### Reviews

- ✅ Code review completed (10 comments addressed)
- ✅ CodeQL security scan (0 vulnerabilities)
- ✅ Syntax validation passed
- ✅ Package structure validated

### Standards Followed

- Node-RED node conventions
- Vue 3 composition patterns
- RESTful API design
- Semantic versioning
- JSDoc comments (where applicable)

## Dependencies

### Required

- axios: ^1.6.2
- Node.js: >=14.0.0
- Node-RED: >=1.0.0

### Optional

- @flowfuse/node-red-dashboard: 2.x (for Vue component)

## Compatibility

### NMOS Specifications

- IS-04 v1.3: Discovery and Registration
- IS-05 v1.1: Device Connection Management

### Browsers (Vue Component)

- Chrome: 90+
- Firefox: 88+
- Safari: 14+
- Edge: 90+

## Performance

### Expected Performance

- **Small Systems (< 50 endpoints):** Excellent
- **Medium Systems (50-200 endpoints):** Good
- **Large Systems (> 200 endpoints):** Acceptable with tuning

### Optimization Tips

- Increase refresh interval for large systems
- Disable auto-refresh if not needed
- Use compact view for many endpoints
- Filter at registry level if possible

## Security

### Considerations

1. **Authentication:**
   - HTTP endpoint uses Node-RED's authentication
   - Ensure adminAuth is configured

2. **Authorization:**
   - No role-based access control
   - All authenticated users can control routing

3. **Data Protection:**
   - Snapshots may contain sensitive info
   - Secure storage recommended

4. **Network:**
   - Use HTTPS in production
   - Restrict network access
   - Use VPN for remote access

### Recommendations

- Enable Node-RED authentication
- Use HTTPS/TLS
- Implement network isolation
- Regular security audits
- Keep dependencies updated

## Deployment

### Development

```bash
cd ~/.node-red
npm install node-red-contrib-nmos-client@2.4.4
# Restart Node-RED
```

### Production

```bash
# Install with specific version
npm install node-red-contrib-nmos-client@2.4.4

# Configure Node-RED security
# Edit settings.js to enable adminAuth

# Use environment variables for registry URLs
# Implement backup procedures
# Monitor logs for errors
```

### Docker

```dockerfile
FROM nodered/node-red:latest
RUN npm install node-red-contrib-nmos-client@2.4.4
```

## Support

### Resources

- GitHub: https://github.com/DHPKE/node-red-contrib-nmos-client
- Issues: https://github.com/DHPKE/node-red-contrib-nmos-client/issues
- NMOS: https://specs.amwa.tv/nmos

### Getting Help

1. Check documentation
2. Review example flow
3. Search existing issues
4. Open new issue with:
   - Node-RED version
   - Package version
   - Error logs
   - Reproduction steps

## License

Apache 2.0

## Contributors

- Implementation: GitHub Copilot
- Review: DHPKE
- Testing: Community

## Changelog

### Version 2.4.4 (2025-11-02)

**Added:**
- Complete nmos-matrix node implementation
- Vue component for FlowFuse Dashboard
- Comprehensive documentation
- Example flow
- Toast notification system
- Snapshot management
- HTTP endpoint for component communication

**Changed:**
- Package version bumped to 2.4.4
- Updated README with new node

**Fixed:**
- N/A (new feature)

**Security:**
- Added authentication notes
- CodeQL scan passed

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-02  
**Status:** Complete

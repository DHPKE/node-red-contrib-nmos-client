# NMOS Matrix Snapshot Architecture

## System Overview

The snapshot system consists of four main components working together to provide comprehensive routing configuration management.

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VUE.JS UI (Browser)                      │
├─────────────────────────────────────────────────────────────────┤
│  💾 Save  │  ⬇️ Export  │  ⬆️ Import  │  Apply Snapshot        │
└────────┬──────────┬──────────┬────────────────┬─────────────────┘
         │          │          │                │
         v          v          v                v
┌────────────────────────────────────────────────────────────────┐
│                      HTTP ENDPOINTS                             │
├────────────────────────────────────────────────────────────────┤
│  POST /snapshot/save                                            │
│  GET  /snapshot/export                                          │
│  POST /snapshot/import                                          │
│  POST /snapshot/apply                                           │
└────────┬──────────┬──────────┬────────────────┬────────────────┘
         │          │          │                │
         v          v          v                v
┌────────────────────────────────────────────────────────────────┐
│                    FUNCTION NODES (Node-RED)                    │
├────────────────────────────────────────────────────────────────┤
│  • Save Snapshot         → Create JSON from current state       │
│  • Export Snapshot       → Format for download                  │
│  • Validate Snapshot     → Check structure & calculate changes  │
│  • Apply Snapshot        → Create routing operations            │
│  • Continue Apply        → Sequential execution loop            │
└────────┬──────────┬──────────┬────────────────┬────────────────┘
         │          │          │                │
         v          v          v                v
┌────────────────────────────────────────────────────────────────┐
│                    STORAGE & ROUTING                            │
├────────────────────────────────────────────────────────────────┤
│  Flow Context Storage                                           │
│  ├─ matrixData: Current senders/receivers/connections          │
│  ├─ snapshots: Saved snapshot history                          │
│  ├─ pendingSnapshot: Imported snapshot awaiting apply          │
│  └─ pendingRoutes: Queue of routing operations                 │
│                                                                 │
│  NMOS Connection Node (IS-05)                                   │
│  └─ Execute routing operations sequentially                     │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Save Snapshot Flow

```
User clicks "Save Snapshot"
    ↓
Vue UI shows modal for name/description
    ↓
User enters metadata and clicks "Save"
    ↓
POST /nmos-matrix/snapshot/save
    ↓
Function: Save Snapshot
    ├─ Get matrixData from flow context
    ├─ Create snapshot object with metadata
    ├─ Add timestamp and version
    ├─ Transform connections to routes
    └─ Store in flow context
    ↓
HTTP Response: Success with snapshot details
    ↓
UI shows confirmation message
```

### Export Snapshot Flow

```
User clicks "Export"
    ↓
GET /nmos-matrix/snapshot/export
    ↓
Function: Export Snapshot
    ├─ Get matrixData from flow context
    ├─ Create snapshot object
    ├─ Format as JSON string
    └─ Add Content-Disposition header
    ↓
HTTP Response: JSON file download
    ↓
Browser downloads file: nmos-routing-snapshot-[timestamp].json
```

### Import & Apply Flow

```
User clicks "Import" and selects file
    ↓
Vue UI reads file and parses JSON
    ↓
POST /nmos-matrix/snapshot/import with snapshot data
    ↓
Function: Validate Snapshot
    ├─ Check version compatibility
    ├─ Validate required fields
    ├─ Get current senders/receivers
    ├─ Check each route:
    │   ├─ Sender exists? → valid
    │   ├─ Receiver exists? → valid
    │   └─ Missing? → mark invalid
    ├─ Calculate routing changes:
    │   ├─ New connections → type: "add"
    │   ├─ Removed connections → type: "remove"
    │   └─ Modified connections → type: "change"
    └─ Store pendingSnapshot in flow context
    ↓
HTTP Response: Validation results with changes preview
    ↓
Vue UI shows Preview Modal
    ├─ Display snapshot metadata
    ├─ Show validation summary
    ├─ List invalid routes (will be skipped)
    └─ List routing changes (add/remove/change)
    ↓
User reviews and clicks "Apply Snapshot"
    ↓
POST /nmos-matrix/snapshot/apply
    ↓
Function: Apply Snapshot
    ├─ Get pendingSnapshot from flow context
    ├─ Create routing messages for each change
    ├─ Store pendingRoutes queue
    └─ Send first routing message
    ↓
NMOS Connection Node (IS-05)
    ├─ Execute routing operation
    └─ Pass result to continuation handler
    ↓
Function: Continue Snapshot Apply
    ├─ Check if more routes in queue
    ├─ If yes: Send next routing message (loop back)
    └─ If no: Mark complete and clean up
    ↓
HTTP Response: Success message
    ↓
UI reloads matrix data to show updated connections
```

## Storage Structure

### Flow Context Variables

```javascript
// Current matrix data
matrixData: {
    senders: [{ id, label, description, ... }],
    receivers: [{ id, label, description, subscription, ... }],
    connections: [{ receiverId, senderId, receiverLabel, senderLabel }],
    timestamp: "2025-11-02T13:44:30Z"
}

// Saved snapshots (for future multi-snapshot support)
snapshots: {
    "snapshot_1234567890": {
        version: "1.0",
        timestamp: "2025-11-02T13:44:30Z",
        name: "Production Setup",
        description: "Main configuration",
        routes: [...]
    }
}

// Pending snapshot (imported, waiting for apply)
pendingSnapshot: {
    snapshot: { /* snapshot object */ },
    validRoutes: [{ sender_id, receiver_id, ... }],
    changes: [{ type, receiverId, senderId, ... }]
}

// Routing queue (during apply)
pendingRoutes: [
    { receiverId: "uuid1", senderId: "uuid2", operation: "activate" },
    { receiverId: "uuid3", senderId: null, operation: "disconnect" }
]

// Apply progress tracking
pendingRouteIndex: 5  // Current position in queue
snapshotApplyInProgress: true  // Flag to prevent concurrent applies
```

## Node Wiring Diagram

```
Save Snapshot Path:
┌─────────────────┐    ┌────────────────┐    ┌────────────────┐
│ http-in-save    │───▶│ save-snapshot  │───▶│ http-response  │
└─────────────────┘    └────────────────┘    └────────────────┘

Export Snapshot Path:
┌─────────────────┐    ┌────────────────┐    ┌────────────────┐
│ http-in-export  │───▶│ export-snpsht  │───▶│ http-response  │
└─────────────────┘    └────────────────┘    └────────────────┘

Import Snapshot Path:
┌─────────────────┐    ┌────────────────┐    ┌────────────────┐
│ http-in-import  │───▶│ validate-snp   │───▶│ http-response  │
└─────────────────┘    └────────────────┘    └────────────────┘

Apply Snapshot Path (with loop):
┌─────────────────┐    ┌────────────────┐    ┌────────────────┐
│ http-in-apply   │───▶│ apply-snapshot │───▶│ http-response  │
└─────────────────┘    └───────┬────────┘    └────────────────┘
                               │
                               ▼
                     ┌─────────────────────┐
                  ┌──│ execute-connection  │◀───┐
                  │  └─────────────────────┘    │
                  │                              │
                  ▼                              │
          ┌──────────────────────┐              │
          │ handle-result        │──────────────┘
          │ (continue or finish) │    Loop for next route
          └──────────────────────┘
```

## Snapshot JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["version", "timestamp", "name", "routes"],
  "properties": {
    "version": {
      "type": "string",
      "const": "1.0",
      "description": "Snapshot format version"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "ISO 8601 timestamp"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "description": "Snapshot name"
    },
    "description": {
      "type": "string",
      "description": "Optional description"
    },
    "routes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["sender_id", "receiver_id", "sender_label", "receiver_label"],
        "properties": {
          "sender_id": {
            "type": "string",
            "format": "uuid",
            "description": "Sender UUID"
          },
          "receiver_id": {
            "type": "string",
            "format": "uuid",
            "description": "Receiver UUID"
          },
          "sender_label": {
            "type": "string",
            "description": "Sender display name"
          },
          "receiver_label": {
            "type": "string",
            "description": "Receiver display name"
          },
          "transport_params": {
            "type": "object",
            "description": "Transport-specific parameters"
          }
        }
      }
    }
  }
}
```

## API Specifications

### POST /nmos-matrix/snapshot/save

**Request:**
```json
{
  "name": "string (required)",
  "description": "string (optional)"
}
```

**Response (200):**
```json
{
  "success": true,
  "snapshot": {
    "version": "1.0",
    "timestamp": "2025-11-02T13:44:30Z",
    "name": "Production Setup",
    "description": "Main configuration",
    "routes": [...]
  },
  "snapshotKey": "snapshot_1234567890"
}
```

### GET /nmos-matrix/snapshot/export

**Response (200):**
- Content-Type: application/json
- Content-Disposition: attachment; filename="nmos-routing-snapshot-[timestamp].json"
- Body: Complete snapshot JSON

### POST /nmos-matrix/snapshot/import

**Request:** Complete snapshot JSON object

**Response (200):**
```json
{
  "valid": true,
  "snapshot": {
    "name": "Production Setup",
    "description": "Main configuration",
    "timestamp": "2025-11-02T13:44:30Z",
    "totalRoutes": 10
  },
  "validation": {
    "validRoutes": 8,
    "invalidRoutes": 2,
    "changes": 5
  },
  "invalidRoutes": [
    {
      "route": { "sender_id": "...", "receiver_id": "..." },
      "reason": "Sender not found: Camera 5"
    }
  ],
  "changes": [
    {
      "type": "add",
      "receiverId": "uuid1",
      "receiverLabel": "Monitor A",
      "senderId": "uuid2",
      "senderLabel": "Camera 1"
    }
  ]
}
```

**Error Response (400):**
```json
{
  "error": "Invalid snapshot: routes must be array"
}
```

### POST /nmos-matrix/snapshot/apply

**Response (200):**
```json
{
  "success": true,
  "message": "Applying snapshot routes",
  "totalRoutes": 5,
  "changes": [...]
}
```

**Error Response (400):**
```json
{
  "error": "No pending snapshot to apply. Import a snapshot first."
}
```

## Error Handling

### Validation Errors

1. **Invalid Version**: Returns 400 with message
2. **Missing Fields**: Returns 400 with specific field
3. **Invalid Structure**: Returns 400 with description

### Runtime Errors

1. **Missing Sender/Receiver**: Marked invalid, skipped during apply
2. **IS-05 Connection Failure**: Logged, continues with next route
3. **Network Timeout**: Logged, user notified in UI

### Recovery Strategies

1. **Partial Apply**: Valid routes applied even if some fail
2. **Idempotent Operations**: Can re-apply snapshot safely
3. **State Preservation**: Original state can be captured before apply

## Performance Characteristics

### Time Complexity

- **Save**: O(n) where n = number of connections
- **Export**: O(n) where n = number of connections
- **Validate**: O(n×m) where n = snapshot routes, m = current receivers
- **Apply**: O(n×t) where n = routes, t = IS-05 operation time (~100-500ms)

### Space Complexity

- **Storage**: O(n) for each snapshot where n = number of routes
- **Memory**: Minimal, uses flow context for state

### Scalability

- **Small Matrix** (< 50 routes): Instant operations
- **Medium Matrix** (50-200 routes): 5-10 seconds for apply
- **Large Matrix** (200+ routes): 20-60 seconds for apply

Sequential execution prevents overwhelming IS-05 API while maintaining reliability.

## Security Considerations

### Input Validation

- JSON structure validation before processing
- UUID format validation
- Type checking for all fields

### Access Control

- Node-RED HTTP endpoints use Node-RED's built-in authentication
- No additional authentication in snapshot layer (handled by Node-RED)

### Data Sanitization

- User inputs sanitized in Vue UI
- No script injection possible in snapshot data
- File downloads use Content-Disposition to prevent XSS

## Future Enhancements

### Potential Features

1. **Multiple Snapshot Storage**: Keep history of saved snapshots
2. **Snapshot Comparison**: Diff two snapshots
3. **Scheduled Snapshots**: Automatic periodic backups
4. **Snapshot Templates**: Pre-defined routing configurations
5. **Rollback Support**: Undo last snapshot application
6. **Bulk Operations**: Apply to subset of receivers
7. **Snapshot Sharing**: Export/import between systems

### API Extensions

1. **GET /snapshots**: List all saved snapshots
2. **GET /snapshots/:id**: Get specific snapshot
3. **DELETE /snapshots/:id**: Delete snapshot
4. **POST /snapshots/:id/apply**: Apply by ID without import

## Integration Points

### With Node-RED

- Uses flow context for state management
- Integrates with existing nmos-connection node
- Compatible with Node-RED dashboard (optional)
- Works with Node-RED authentication

### With NMOS

- **IS-04**: Query API for discovering senders/receivers
- **IS-05**: Connection API for routing operations
- Standard NMOS UUIDs and resource types
- Compatible with all NMOS-compliant devices

### With External Systems

- Standard JSON format for interoperability
- HTTP API for automation scripts
- File-based export/import for version control
- CLI-friendly with curl/wget

## Troubleshooting Guide

### Common Issues

1. **Empty Export**: Matrix data not loaded → Click Refresh first
2. **Invalid Routes**: Devices changed → Review preview, valid routes still apply
3. **Apply Fails**: IS-05 error → Check logs, retry individual routes
4. **Slow Apply**: Many routes → Expected, wait for completion

### Debug Mode

Check Node-RED debug panel for:
- Snapshot save confirmations
- Validation results
- Routing operation status
- Error messages

## References

- [NMOS IS-04 Specification](https://specs.amwa.tv/is-04/)
- [NMOS IS-05 Specification](https://specs.amwa.tv/is-05/)
- [Node-RED Documentation](https://nodered.org/docs/)
- [Vue.js 3 Documentation](https://vuejs.org/)

# NMOS Matrix Snapshot - Quick Reference

## Quick Start

### Web UI
```
http://localhost:1880/nmos-matrix
```

### Buttons
| Button | Action |
|--------|--------|
| 💾 Save Snapshot | Save current routing to memory |
| ⬇️ Export | Download routing as JSON file |
| ⬆️ Import | Load snapshot from JSON file |
| Apply Snapshot | Restore routing from imported snapshot |

## API Endpoints

### Save Current Routing
```bash
POST /nmos-matrix/snapshot/save
Content-Type: application/json

{
  "name": "Snapshot Name",
  "description": "Optional description"
}
```

### Export as JSON File
```bash
GET /nmos-matrix/snapshot/export
# Downloads: nmos-routing-snapshot-[timestamp].json
```

### Import & Validate
```bash
POST /nmos-matrix/snapshot/import
Content-Type: application/json

{
  "version": "1.0",
  "timestamp": "2025-11-02T13:44:30Z",
  "name": "Production Setup",
  "description": "Main configuration",
  "routes": [...]
}
```

### Apply Snapshot
```bash
POST /nmos-matrix/snapshot/apply
# Applies previously imported snapshot
```

## Common Tasks

### Quick Backup
```bash
curl http://localhost:1880/nmos-matrix/snapshot/export \
  -o backup-$(date +%Y%m%d).json
```

### Restore from Backup
```bash
# Import
curl -X POST http://localhost:1880/nmos-matrix/snapshot/import \
  -H "Content-Type: application/json" \
  -d @backup-20251102.json

# Apply (after reviewing preview)
curl -X POST http://localhost:1880/nmos-matrix/snapshot/apply
```

### Save with Metadata
```bash
curl -X POST http://localhost:1880/nmos-matrix/snapshot/save \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Live Show Setup",
    "description": "Main broadcast configuration"
  }'
```

## Snapshot JSON Format

```json
{
  "version": "1.0",
  "timestamp": "2025-11-02T13:44:30Z",
  "name": "Snapshot Name",
  "description": "Description (optional)",
  "routes": [
    {
      "sender_id": "uuid",
      "receiver_id": "uuid",
      "sender_label": "Sender Name",
      "receiver_label": "Receiver Name",
      "transport_params": {}
    }
  ]
}
```

## Workflow

```
1. Create Snapshot
   ↓
2. Export to File (backup)
   ↓
3. Make routing changes
   ↓
4. Import snapshot when needed
   ↓
5. Review preview & validation
   ↓
6. Apply snapshot to restore
```

## Change Types

| Type | Icon | Description |
|------|------|-------------|
| Add | ➕ | New connection to create |
| Remove | ➖ | Existing connection to delete |
| Change | 🔄 | Connection to modify |

## Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Invalid snapshot format |
| 500 | Server error |

## Validation Results

```json
{
  "valid": true,
  "validation": {
    "validRoutes": 10,      // Can be applied
    "invalidRoutes": 2,     // Will be skipped
    "changes": 5            // Total changes needed
  },
  "invalidRoutes": [...],   // Details of invalid routes
  "changes": [...]          // Details of routing changes
}
```

## Tips

✅ **DO:**
- Use descriptive snapshot names
- Export before major changes
- Review preview before applying
- Keep backups in version control

❌ **DON'T:**
- Apply without reviewing preview
- Use generic names like "test"
- Skip validation messages
- Delete backups immediately

## Troubleshooting

### Issue: Invalid routes in snapshot
**Solution:** Review preview modal, invalid routes will be skipped

### Issue: Export returns empty
**Solution:** Click "Refresh" in matrix UI first

### Issue: Apply doesn't work
**Solution:** Import snapshot first, then apply

### Issue: Changes not shown
**Solution:** Routing already matches snapshot (no action needed)

## Files & Locations

- **Flow**: `/examples/dynamic-matrix-flow.json`
- **Documentation**: `MATRIX_FLOW.md`
- **Examples**: `SNAPSHOT_EXAMPLES.md`
- **Matrix UI**: `http://localhost:1880/nmos-matrix`

## Support

- GitHub: https://github.com/DHPKE/node-red-contrib-nmos-client
- Issues: https://github.com/DHPKE/node-red-contrib-nmos-client/issues
- Full Docs: [MATRIX_FLOW.md](MATRIX_FLOW.md)

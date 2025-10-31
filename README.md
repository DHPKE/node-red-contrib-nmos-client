### IS-07 Event & Tally
- ✅ MQTT-based event transport
- ✅ State messages (rebootstrap) with retained flag
- ✅ Event messages (deltas) with pre/post tracking
- ✅ Grain message format with TAI timestamps
- ✅ IS-04 registration (node, device, source, flow)
- ✅ Topic structure: `x-nmos/events/1.0/{source_id}/{event_type}`
- ✅ Property state management
- ✅ Support for boolean, string, number, enum, object types

#### IS-07 Quick Start

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
```
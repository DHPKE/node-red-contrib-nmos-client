# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **nmos-is07-endpoint node** - New NMOS endpoint node for receiving IS-07 events and control commands
  - Subscribe to IS-07 events via MQTT
  - Automatic RIEDEL Smartpanel command parsing
  - Support for 6 command types: GPIO, buttons, tally, faders, encoders, generic properties
  - Bidirectional communication (receive commands, send status updates)
  - Command history tracking (up to 100 commands)
  - State management from multiple event sources
  - IS-04 receiver registration with heartbeat
  - Configurable MQTT subscription filters
  - Comprehensive input actions (get_state, get_received_states, get_command_history, send_status, etc.)

- **Documentation**
  - `docs/is07-endpoint-smartpanel.md` - Complete reference guide (637 lines)
    - Architecture and features overview
    - Configuration instructions
    - RIEDEL Smartpanel integration guide
    - Command pattern reference with examples
    - Real-world broadcast scenarios
    - Troubleshooting guide
    - Best practices
    - Advanced topics
  - `docs/is07-endpoint-quickstart.md` - 5-minute quick start guide (258 lines)
    - Step-by-step setup
    - Prerequisites
    - Configuration walkthrough
    - Quick testing instructions
    - Common use cases
  - `docs/is07-endpoint-testing.md` - Testing and validation guide (596 lines)
    - Test environment setup
    - 10 comprehensive test cases
    - MQTT test commands
    - Automated test scripts
    - Performance testing
    - Test results template

- **Examples**
  - `examples/is07-endpoint-smartpanel-example.json` - 4 production-ready example flows
    - Basic endpoint setup
    - Smartpanel command processing with routing
    - Bidirectional tally feedback loop
    - Multi-camera production scenario

- **Package Updates**
  - Registered nmos-is07-endpoint in package.json
  - Added keywords: riedel, smartpanel, endpoint, gpio
  - Updated README with nmos-is07-endpoint documentation

### Changed
- README.md - Added comprehensive documentation section for nmos-is07-endpoint node
- package.json - Added nmos-is07-endpoint to node registrations

### Fixed
- Null pointer exceptions in Smartpanel command parsing regex matching
- Added proper null checks before accessing regex match groups
- Documented TAI offset with reference to leap seconds

### Technical Details
- **Total Lines Added**: ~3,000 lines of code and documentation
- **Code Quality**: 
  - ✅ JavaScript syntax validated
  - ✅ JSON files validated
  - ✅ CodeQL security scan passed (0 alerts)
  - ✅ Null pointer exceptions fixed
  - ✅ Production-ready error handling

### Use Cases Enabled
- Camera tally control in broadcast studios
- Production automation triggered by Smartpanel buttons
- Status feedback to operators via tally lights
- Remote control of broadcast equipment
- Integration with production switchers and routers
- Multi-camera production workflows
- Distributed production setups

### Supported Command Types
1. **GPIO/GPI Inputs** - `gpio/input/N`, `gpi/N`
2. **Button/Key Presses** - `button/N`, `key/N`, `switch/N`
3. **Tally Signals** - `tally/red`, `tally/green`, `tally/amber`, `tally/program`, `tally/preview`
4. **Faders/Levels** - `fader/N`, `level/N`, `gain/N`
5. **Encoders/Rotary** - `encoder/N`, `rotary/N`
6. **Generic Properties** - Any other path pattern

### Integration Points
- **IS-04**: Automatic receiver registration
- **IS-07**: MQTT-based event subscription
- **RIEDEL Smartpanel**: Native command parsing
- **MQTT**: Configurable broker and QoS
- **Node-RED**: Full flow integration

---

## Previous Releases

See Git history for changes prior to this version.

# Device Script Language

A simple, line-based scripting language for automating UART device control and testing.

## Features

- Text-based command protocol
- Variable interpolation
- Pattern matching for responses
- Flow control (IF, GOTO, labels)
- Built-in timestamp tracking
- Math functions (ABS, SQRT, POW, MIN, MAX, etc.)
- Timeout protection
- Infinite loop detection

## Quick Start

1. Include the script runner in your project:
const ScriptRunner = require('./script-runner.js');
const uart = require('./uart.js');

2. Create a script:
SET target = 90
SEND DP{target}
WAIT 500
SENDNW GPS
RECV PS:{position}
PRINT Position: {position}

3. Run it:
const script = document.getElementById('scriptText').value;
const logFn = (msg) => console.log(msg);

const runner = new ScriptRunner(script, uart, logFn);
await runner.run();

## Documentation

See `SCRIPT_LANGUAGE.md` for complete language reference.

## Examples

Check the `examples/` folder for:
- `motor_test.txt` - Basic motor positioning test
- `position_with_retry.txt` - Positioning with retry logic and timeout
- `sweep_test.txt` - Back-and-forth sweep motion
- `voltage_monitor.txt` - Continuous voltage monitoring with statistics

## Safety

- Scripts timeout if waiting too long for responses
- Infinite loop protection (max 100,000 iterations)
- User can stop execution at any time
- UART port must be open before running

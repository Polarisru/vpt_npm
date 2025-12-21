# Device Script Language Documentation

A simple scripting language for automating UART device control and testing.

## Commands

### SEND command
Sends a command to the device and waits for "OK" acknowledgment.

**Syntax:**
SEND command

**Examples:**
SEND DP45.0
SEND DP{angle}

---

### SENDRECV command
Sends a command and waits for a response matching a pattern and captures numeric value(s) into variable(s).

**Syntax:**
SENDRECV command response

**Examples:**
SENDRECV GPS PS:{position} # Sends GPS and captures: PS:45.2 -> position = 45.2
SENDRECV DPR{target} PS:{angle} # Sends DPR and captures: PS:90.0 -> angle = 90.0

---

### SET command
Assigns a value to a variable. Supports arithmetic expressions.

**Syntax:**
SET variable = expression

**Examples:**
SET angle = 45.0
SET target = angle + 10
SET diff = target - current
SET distance = ABS(diff)
SET max_val = MAX(temp1, temp2)
SET start_time = {time_ms}

---

### WAIT command
Delays execution for specified milliseconds.

**Syntax:**
WAIT milliseconds

**Examples:**
WAIT 1000 # Wait 1 second
WAIT 500 # Wait 0.5 seconds

---

### PRINT command
Prints a message to the output log. Supports variable interpolation.

**Syntax:**
PRINT message with {variables}

**Examples:**
PRINT Script started
PRINT Current position: {position}
PRINT [{elapsed_sec}s] Moving to {target} degrees
PRINT Time: {timestamp}

---

### RESULT command
Returns a message to the main window to display it as a system message. Supports variable interpolation.

**Syntax:**
RESULT message with {variables}

**Examples:**
RESULT Script finished successfully
RESULT Resulting position: {position}

---

### IF command
Conditional jump to a label if condition is true.

**Syntax:**
IF condition GOTO label

**Operators:** `<`, `>`, `<=`, `>=`, `==`, `!=`

**Examples:**
IF voltage < 12.0 GOTO error
IF distance < 2.0 GOTO success
IF count >= 10 GOTO done
IF temp1 > temp2 GOTO use_temp1

---

### GOTO command
Unconditional jump to a label.

**Syntax:**
GOTO label

**Example:**
GOTO retry
GOTO done

---

### LABEL command
Defines a jump target for GOTO and IF commands.

**Syntax:**
LABEL name

**Examples:**
LABEL start
LABEL retry
LABEL error
LABEL done

---

### Comments
Lines starting with `#` are comments and are ignored.

**Example:**
This is a comment
SET x = 10 # This is also a comment

---

## Built-in Variables

### Timestamp Variables
- `{timestamp}` - ISO timestamp (e.g., "2025-11-27T22:57:00.123Z")
- `{time_ms}` - Current time in milliseconds since epoch
- `{elapsed_ms}` - Milliseconds since script started
- `{elapsed_sec}` - Seconds since script started (3 decimal places)

**Usage:**
PRINT Script started at {timestamp}
SET start = {time_ms}
PRINT [{elapsed_sec}s] Checkpoint reached

---

## Math Functions

Available in SET and IF expressions:

- `ABS(x)` - Absolute value
- `SQRT(x)` - Square root
- `POW(x, y)` - x to the power of y
- `MIN(a, b)` - Minimum of two values
- `MAX(a, b)` - Maximum of two values
- `FLOOR(x)` - Round down to integer
- `CEIL(x)` - Round up to integer
- `ROUND(x)` - Round to nearest integer
- `FIXED(x, y)` - Display a number with a given number of decimal places

**Examples:**
SET distance = ABS(target - current)
SET hypotenuse = SQRT(POW(x, 2) + POW(y, 2))
SET max_temp = MAX(temp1, temp2)

---

## Arithmetic Operators

- `+` Addition
- `-` Subtraction
- `*` Multiplication
- `/` Division

**Examples:**
SET result = (a + b) * 2
SET average = (x + y) / 2
SET negative = 0 - value

---

## Variable Interpolation

Use `{variable}` syntax to insert variable values into:
- SEND commands
- PRINT messages
- Expressions (automatic)

**Examples:**
SET angle = 90
SEND DP{angle} # Sends: DP90
PRINT Position: {angle} # Prints: Position: 90

---

## Error Handling

Scripts stop on errors:
- Undefined variables
- Timeout waiting for response
- Command fails (no OK received)
- Unknown labels
- Invalid expressions
- Infinite loop protection (max 100,000 iterations)

---

## Safety Features

- **Timeout protection**: RECV and SEND commands timeout after 3-5 seconds
- **Infinite loop detection**: Script stops after 100,000 iterations
- **Port check**: Script requires UART port to be open
- **Stop button**: User can stop script execution at any time

---

## Complete Example

See `examples/` folder for complete working examples.

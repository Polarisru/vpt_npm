// script-runner.js
// Simple scripting language interpreter for UART device control

class ScriptRunner {
  constructor(script, uart, logFn) {
    this.script = script;
    this.uart = uart;
    this.log = logFn;
    this.lines = [];
    this.labels = {};
    this.variables = {};
    this.pc = 0;
    this.running = false;
    this.startTime = Date.now();
    this.maxIterations = 100000;
    this.iterationCount = 0;
    
    this.parse();
  }

  parse() {
    const rawLines = this.script.split('\n');
    
    rawLines.forEach((line, index) => {
      line = line.trim();
      
      // Skip empty lines and comments
      if (!line || line.startsWith('#')) return;
      
      const tokens = line.split(/\s+/);
      const cmd = tokens[0].toUpperCase();
      
      if (cmd === 'LABEL') {
        this.labels[tokens[1]] = this.lines.length;
      } else if (cmd === 'END') {
        // Optional end marker
      } else {
        this.lines.push(this.parseLine(line, tokens));
      }
    });
  }
  
  // Remove inline comments: everything after '#' that is not inside {...}
  stripInlineComment(text) {
    let inBrace = false;
    let result = '';

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === '{') {
        inBrace = true;
        result += ch;
      } else if (ch === '}') {
        inBrace = false;
        result += ch;
      } else if (ch === '#' && !inBrace) {
        // Start of comment -> stop copying
        break;
      } else {
        result += ch;
      }
    }

    return result.trimEnd();
  }

  parseLine(line, tokens) {
    const cmd = tokens[0].toUpperCase();

    switch(cmd) {
      case 'SEND': {
        const text = this.stripInlineComment(tokens.slice(1).join(' '));
        return { type: 'SEND', text, waitForOk: true };
      }
      
      case 'SENDRECV': {
        const command = this.stripInlineComment(tokens[1]);
        const patternRaw = tokens.slice(2).join(' ');
        const pattern = this.stripInlineComment(patternRaw);
        return { type: 'SENDRECV', command, pattern };
      }
        
      case 'WAIT': {
        // Allow expressions like: WAIT 500, WAIT settle_ms, WAIT settle_ms + 100 # comment
        const msRaw = tokens.slice(1).join(' ');
        const msExpr = this.stripInlineComment(msRaw);
        return { type: 'WAIT', msExpr };
      }

      case 'SET': {
        const varName = tokens[1];
        const exprRaw = tokens.slice(3).join(' ');
        const expr = this.stripInlineComment(exprRaw);
        return { type: 'SET', variable: varName, expression: expr };
      }

      case 'PRINT': {
        const text = this.stripInlineComment(tokens.slice(1).join(' '));
        return { type: 'PRINT', text };
      }

      case 'IF': {
        // condition is tokens[1..-3], then "GOTO label"
        const condRaw = tokens.slice(1, -2).join(' ');
        const condition = this.stripInlineComment(condRaw);
        const gotoLabel = tokens[tokens.length - 1];
        return { type: 'IF', condition, label: gotoLabel };
      }

      case 'GOTO':
        return { type: 'GOTO', label: tokens[1] };

      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  }

  async run() {
    if (!this.uart.isOpen()) {
      throw new Error('UART port is not open');
    }
    
    this.running = true;
    this.startTime = Date.now();
    this.iterationCount = 0;
    this.pc = 0;
    
    this.logWithTimestamp('Script started');
    
    try {
      while (this.running && this.pc < this.lines.length) {
        if (++this.iterationCount > this.maxIterations) {
          throw new Error('Maximum iterations exceeded - possible infinite loop');
        }
        
        await this.executeLine(this.lines[this.pc]);
        this.pc++;
      }
      
      this.logWithTimestamp('Script completed');
    } catch (error) {
      this.logWithTimestamp(`Error: ${error.message}`);
      this.running = false;
      throw error;
    }
  }

  stop() {
    this.running = false;
    this.logWithTimestamp('Script stopped by user');
  }

  async executeLine(cmd) {
    if (!this.running) return;
    
    switch(cmd.type) {
      case 'SEND':
        await this.executeSEND(cmd);
        break;
      case 'SENDRECV':
        await this.executeSENDRECV(cmd);
        break;
      case 'WAIT':
        await this.executeWAIT(cmd);
        break;
      case 'SET':
        this.executeSET(cmd);
        break;
      case 'PRINT':
        this.executePRINT(cmd);
        break;
      case 'IF':
        this.executeIF(cmd);
        break;
      case 'GOTO':
        this.executeGOTO(cmd);
        break;
    }
  }

  async executeSEND(cmd) {
    const command = this.substituteVars(cmd.text);
    this.logWithTimestamp(`TX: ${command}`);
    
    if (cmd.waitForOk) {
      // Send and wait for "OK" acknowledgment
      try {
        const response = await this.uart.sendAndWait(command, (line) => {
          return line.trim().toUpperCase() === 'OK';
        }, 3000);
        this.logWithTimestamp(`RX: ${response.trim()}`);
      } catch (error) {
        throw new Error(`Command "${command}" failed: no OK received`);
      }
    } else {
      // Just send without waiting
      this.uart.send(command);
    }
  }

  async executeSENDRECV(cmd) {
    const varMatch = cmd.pattern.match(/\{(\w+)\}/);
    if (!varMatch) {
      throw new Error(`SENDRECV pattern must contain variable: ${cmd.pattern}`);
    }

    const varName = varMatch[1];
    const regexPattern = cmd.pattern.replace(/\{(\w+)\}/g, '([\\d\\.\\-]+)');
    const regex = new RegExp(regexPattern);

    this.logWithTimestamp(`TX: ${cmd.command}`);
    
    try {
      const response = await this.uart.sendAndWait(cmd.command, () => true, 1000);
      this.logWithTimestamp(`RX: ${response.trim()}`);
      
      const match = response.match(regex);
      
      if (match && match[1]) {
        this.variables[varName] = parseFloat(match[1]);
      } else {
        throw new Error(`Failed to extract value from: ${response}`);
      }
    } catch (error) {
      throw new Error(`Command "${cmd.command}" failed or timeout`);
    }
  }

  async waitForResponse(regex, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.uart.emitter.removeListener('line', lineHandler);
        reject(new Error('Timeout'));
      }, timeoutMs);
      
      const lineHandler = (line) => {
        if (regex.test(line)) {
          clearTimeout(timeout);
          this.uart.emitter.removeListener('line', lineHandler);
          resolve(line);
        }
      };
      
      this.uart.emitter.on('line', lineHandler);
    });
  }

  async executeWAIT(cmd) {
    // Evaluate the expression to get actual milliseconds
    const ms = this.evaluateExpression(cmd.msExpr);
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  executeSET(cmd) {
    const value = this.evaluateExpression(cmd.expression);
    this.variables[cmd.variable] = value;
  }

  executePRINT(cmd) {
    const message = this.substituteVars(cmd.text);
    this.logWithTimestamp(message);
  }

  executeIF(cmd) {
    const condition = this.substituteVars(cmd.condition);
    const result = this.evaluateExpression(condition);
    
    if (result) {
      this.executeGOTO({ label: cmd.label });
    }
  }

  executeGOTO(cmd) {
    if (!(cmd.label in this.labels)) {
      throw new Error(`Unknown label: ${cmd.label}`);
    }
    this.pc = this.labels[cmd.label] - 1;
  }

  substituteVars(text) {
    return text.replace(/\{(\w+)\}/g, (_, varName) => {
      // Built-in timestamp variables
      if (varName === 'timestamp') {
        return new Date().toISOString();
      }
      if (varName === 'time_ms') {
        return Date.now();
      }
      if (varName === 'elapsed_ms') {
        return Date.now() - this.startTime;
      }
      if (varName === 'elapsed_sec') {
        return ((Date.now() - this.startTime) / 1000).toFixed(3);
      }
      
      // User variables
      if (!(varName in this.variables)) {
        throw new Error(`Undefined variable: ${varName}`);
      }
      return this.variables[varName];
    });
  }
  
  substituteVarsInExpression(expr) {
    // First replace {var} style
    let result = this.substituteVars(expr);
    
    // Then replace bare variable names (alphanumeric identifiers)
    // Match whole words that are variable names
    return result.replace(/\b([a-z_]\w*)\b/gi, (match) => {
      if (match in this.variables) {
        return this.variables[match];
      }
      return match;  // leave it if not a variable
    });
  }  

  evaluateExpression(expr) {
    const substituted = this.substituteVarsInExpression(expr);
    try {
      // Provide common math functions
      return new Function(
        'ABS', 'SQRT', 'POW', 'MIN', 'MAX', 'FLOOR', 'CEIL', 'ROUND',
        'return ' + substituted
      )(
        Math.abs,
        Math.sqrt,
        Math.pow,
        Math.min,
        Math.max,
        Math.floor,
        Math.ceil,
        Math.round
      );
    } catch (error) {
      throw new Error(`Invalid expression: ${expr}`);
    }
  }

  logWithTimestamp(message) {
    const timestamp = new Date().toLocaleTimeString('en-GB', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 3
    });
    
    this.log(`[${timestamp}] ${message}`);
  }

  getState() {
    return {
      running: this.running,
      pc: this.pc,
      totalLines: this.lines.length,
      variables: { ...this.variables },
      iterations: this.iterationCount
    };
  }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScriptRunner;
}

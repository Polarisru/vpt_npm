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

  parseLine(line, tokens) {
    const cmd = tokens[0].toUpperCase();
    
    switch(cmd) {
      case 'SEND':
        return { type: 'SEND', text: tokens.slice(1).join(' '), waitForOk: true };
        
      case 'SENDNW':
        return { type: 'SEND', text: tokens.slice(1).join(' '), waitForOk: false };
        
      case 'RECV':
        return { type: 'RECV', pattern: tokens.slice(1).join(' ') };
        
      case 'WAIT':
        return { type: 'WAIT', ms: parseInt(tokens[1]) };
        
      case 'SET':
        const varName = tokens[1];
        // tokens[2] is '='
        const expr = tokens.slice(3).join(' ');
        return { type: 'SET', variable: varName, expression: expr };
  
      case 'PRINT':
        return { type: 'PRINT', text: tokens.slice(1).join(' ') };
        
      case 'IF':
        const condition = tokens.slice(1, -2).join(' ');
        const gotoLabel = tokens[tokens.length - 1];
        return { type: 'IF', condition: condition, label: gotoLabel };
        
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
      case 'RECV':
        await this.executeRECV(cmd);
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

  async executeRECV(cmd) {
    const varMatch = cmd.pattern.match(/\{(\w+)\}/);
    if (!varMatch) {
      throw new Error(`RECV pattern must contain variable: ${cmd.pattern}`);
    }
    
    const varName = varMatch[1];
    const regexPattern = cmd.pattern.replace(/\{(\w+)\}/g, '([\\d\\.\\-]+)');
    const regex = new RegExp(regexPattern);
    
    try {
      const response = await this.waitForResponse(regex, 5000);
      
      const match = response.match(regex);
      if (match && match[1]) {
        this.variables[varName] = parseFloat(match[1]);
        this.logWithTimestamp(`RX: ${response.trim()} -> ${varName} = ${this.variables[varName]}`);
      } else {
        throw new Error(`Failed to extract value from: ${response}`);
      }
    } catch (error) {
      throw new Error(`Timeout waiting for response matching: ${cmd.pattern}`);
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
    await new Promise(resolve => setTimeout(resolve, cmd.ms));
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
      if (varName === 'timestamp') return new Date().toISOString();
      if (varName === 'time_ms') return Date.now();
      if (varName === 'elapsed_ms') return Date.now() - this.startTime;
      if (varName === 'elapsed_sec') return ((Date.now() - this.startTime) / 1000).toFixed(3);
      
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

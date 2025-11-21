// uart.js

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const EventEmitter = require('events');

let port = null;
let parser = null;
let buffer = '';
const emitter = new EventEmitter();

let pendingRequests = []; // { resolve, reject, matcher, timeout }

function isOpen() {
    return port && port.isOpen;
}

function close() {
    if (port) {
        try {
            port.removeAllListeners();
            if (parser) parser.removeAllListeners();
            port.close(err => {
                if (err) console.error('UART close error:', err.message);
            });
        } catch (e) {
            console.error('UART close exception:', e.message);
        }
    }
    port = null;
    parser = null;
    buffer = '';

    pendingRequests.forEach(p => {
        clearTimeout(p.timeout);
        p.reject(new Error('Port closed'));
    });
    pendingRequests = [];
}

function open(path, baudRate) {
    return new Promise((resolve, reject) => {
        if (isOpen()) {
            close();
        }

        port = new SerialPort({ path, baudRate }, err => {
            if (err) {
                console.error('UART open error:', err.message);
                close();
                reject(err);
                return;
            }
            setupListeners();
            resolve();
        });
    });
}

function setupListeners() {
    parser = port.pipe(new ReadlineParser({ delimiter: '\r' }));

    parser.on('data', handleLine);

    port.on('data', chunk => {
        const chars = chunk.toString('ascii');
        for (const c of chars) {
            if (c === '\x1B') {
                buffer = '';
            } else if (c === '\r') {
                handleLine(buffer);
                buffer = '';
            } else {
                buffer += c;
            }
        }
    });

    port.on('error', err => {
        console.error('UART error:', err.message);
        emitter.emit('error', err);
        close();
    });

    port.on('close', () => {
        console.log('UART port closed');
        close();
    });
}

function handleLine(line) {
    emitter.emit('line', line);

    for (let i = 0; i < pendingRequests.length; i++) {
        const { matcher, resolve, timeout } = pendingRequests[i];
        if (matcher(line)) {
            resolve(line);
            clearTimeout(timeout);
            pendingRequests.splice(i, 1);
            break;
        }
    }
}

function send(cmd) {
    if (!isOpen()) {
        console.warn('UART send called but port not open');
        return;
    }
    port.write(cmd + '\r');
}

function sendAndWait(cmd, matcher, delayMs = 1000) {
    return new Promise((resolve, reject) => {
        if (!isOpen()) {
            reject(new Error('Port not open'));
            return;
        }

        const timeout = setTimeout(() => {
            const idx = pendingRequests.findIndex(p => p.timeout === timeout);
            if (idx >= 0) pendingRequests.splice(idx, 1);
            reject(new Error('Timeout waiting for response'));
        }, delayMs);

        pendingRequests.push({ resolve, reject, matcher, timeout });
        send(cmd);
    });
}

function onLine(cb) {
    emitter.on('line', cb);
}

module.exports = {
    open,
    close,
    send,
    sendAndWait,
    onLine,
    isOpen
};

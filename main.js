const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let selectWindow;
let mainWindow;

function createSelectWindow() {
    selectWindow = new BrowserWindow({
        width: 320,           // Increased slightly
        height: 250,          // Increased to fit content
        resizable: false,
        autoHideMenuBar: true,    // Hide menu bar
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    selectWindow.loadFile('index.html');
    selectWindow.setMenuBarVisibility(false);  // Completely remove it
}

function createMainWindow(selectedPort) {
    mainWindow = new BrowserWindow({
        width: 1000,          // Bigger window
        height: 700,
        minWidth: 1000,   // minimal allowed width
        minHeight: 600,  // minimal allowed height
        autoHideMenuBar: true,    // Hide menu bar
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('main.html');
    mainWindow.setMenuBarVisibility(false);  // Completely remove it
    
    // Send the selected port to the new window
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('selected-port', selectedPort);
    });
}

// Listen for port selection from renderer
ipcMain.on('port-selected', (event, port) => {
    console.log('Port selected:', port);
    createMainWindow(port);
    selectWindow.close();  // Close the small window
});

app.whenReady().then(createSelectWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

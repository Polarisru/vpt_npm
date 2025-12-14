// firmware-updater.js
const uart = require('./uart');

class FirmwareUpdater {
  constructor(deviceController) {
    this.device = deviceController;
  }

  crc16(pageData) {
    const polynomial = 0x8005;
    let crc = 0xFFFF;
    for (let i = 0; i < pageData.length; i++) {
      crc ^= (pageData[i] << 8);
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) {
          crc = (crc << 1) ^ polynomial;
        } else {
          crc = (crc << 1);
        }
      }
      crc &= 0xFFFF;
    }
    return crc & 0xFFFF;
  }

  async enterBootloader(win, totalPages, isMainUpdate) {
    const statusText = 'Entering bootloader...';
    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: statusText
    });

    if (isMainUpdate) {
      await uart.send('UPFW1234');
    }

    await new Promise(resolve => setTimeout(resolve, 10));
    const blsStart = Date.now();
    let blsResponse = null;
    const timeout = isMainUpdate ? 1000 : 100;

    while (Date.now() - blsStart < 5000) {
      try {
        const res = await this.device.queuedSendAndWait('BLS', line => line.trim() === 'OK', timeout);
        if (res) {
          blsResponse = res;
          break;
        }
      } catch {
        // ignore timeout, retry
      }
      await new Promise(resolve => setTimeout(resolve, isMainUpdate ? 100 : 50));
    }

    if (!blsResponse) {
      throw new Error('Failed to enter bootloader: No OK response within 5s');
    }

    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: 'Flashing pages...'
    });
  }

  async flashPages(win, pages, totalPages, indexWidth) {
    let successCount = 0;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      let attempts = 0;
      let pageSuccess = false;

      while (attempts < 3 && !pageSuccess) {
        attempts++;
        const pageIndexHex = page.index.toString(16).toUpperCase().padStart(indexWidth, '0');
        await uart.send(`BLF${pageIndexHex}`);
        await new Promise(resolve => setTimeout(resolve, 10));
        await uart.writeBinary(page.data);

        // We re-use device queue to wait for OK response
        const response = await this.device.queuedSendAndWait('', line => line.trim() === 'OK', 2000);

        if (response) {
          pageSuccess = true;
          successCount++;
        } else {
          console.warn(`Page ${page.index} attempt ${attempts} failed`);
          if (attempts < 3) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }

      if (!pageSuccess) {
        throw new Error(`Failed to flash page ${page.index} after 3 attempts`);
      }

      win.webContents.send('update-progress', {
        current: successCount,
        total: totalPages,
        text: `Flashed page ${successCount}/${totalPages}`
      });
    }
  }

  async verifyPages(win, pages, totalPages, indexWidth) {
    win.webContents.send('update-progress', {
      current: 0,
      total: totalPages,
      text: 'Verifying pages...'
    });

    let verifyCount = 0;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const crc = this.crc16(page.data);
      const pageIndexHex = page.index.toString(16).toUpperCase().padStart(indexWidth, '0');
      const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');
      const cmd = `BLC${pageIndexHex}:${crcHex}`;

      const verifyResp = await this.device.queuedSendAndWait(cmd, line => line.trim() === 'OK', 200);

      if (!verifyResp) {
        throw new Error(`Verification failed for page ${page.index} (CRC ${crcHex})`);
      }

      verifyCount++;
      win.webContents.send('update-progress', {
        current: verifyCount,
        total: totalPages,
        text: `Verified page ${verifyCount}/${totalPages}`
      });
    }
  }

  async exitBootloader(win, totalPages, text) {
    await uart.send('BLQ');
    win.webContents.send('update-progress', {
      current: totalPages,
      total: totalPages,
      text
    });
  }

  // Main firmware: UPFW + BLS
  async performUpdate(win, pages, totalPages) {
    await this.enterBootloader(win, totalPages, true);
    await this.flashPages(win, pages, totalPages, 3); // BLFxxx, 3-digit index
    await this.verifyPages(win, pages, totalPages, 3); // BLCxxx
    await this.exitBootloader(win, totalPages, 'Update complete');
  }

  // Upload: only BLS with 100ms timeout
  async performUpload(win, pages, totalPages) {
    await this.enterBootloader(win, totalPages, false);
    await this.flashPages(win, pages, totalPages, 2); // BLFxx, 2-digit index
    await this.verifyPages(win, pages, totalPages, 2); // BLCxx
    await this.exitBootloader(win, totalPages, 'Upload complete');
  }
}

module.exports = FirmwareUpdater;

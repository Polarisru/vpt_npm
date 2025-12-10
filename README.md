# vpt_npm
npm project for VPT GUI

## Run project
npm start

## Install npm on Linux
sudo apt-get install nodejs npm
### To make an executable
sudo apt-get install dpkg fakeroot rpm

## Create a distributable
Install Forge:
npm install --save-dev @electron-forge/cli
npx electron-forge import

Create:
npm run make

## Open debug console:
Ctrl+Shift+I

## Add UART port permissions
sudo usermod -a -G dialout your_user
sudo usermod -a -G tty your_user 
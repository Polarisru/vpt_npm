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

## Android
Rebuild for Android:
  npx cap sync android
Start Android Studion:
  npx cap open android

Rebuild JS: 
  npx webpack
  npx cap sync
  npx cap run android
 
# 1. Install Android dependencies
npm install @capacitor/core @capacitor/cli @capacitor/android @adeunis/capacitor-serial

# 2. Install Webpack (The "Translator")
npm install --save-dev webpack webpack-cli process buffer stream-browserify events path-browserify copy-webpack-plugin

# 3. Initialize Capacitor
npx cap init MyApp com.yourcompany.app --web-dir=dist
npx cap add android
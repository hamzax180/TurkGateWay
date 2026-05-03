const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  openLog: () => ipcRenderer.invoke('open-log')
})

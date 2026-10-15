import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('corumDesktop', {
  closeStartupPreview: () => ipcRenderer.send('corum:startup-preview-close'),
})

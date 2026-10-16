import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // project
  openFolder: () => ipcRenderer.invoke('project:open'),
  setProjectRoot: (dir) => ipcRenderer.invoke('project:setRoot', dir),
  getProjectRoot: () => ipcRenderer.invoke('project:root'),

  // filesystem (scoped to the open project)
  readDir: (p) => ipcRenderer.invoke('fs:readDir', p),
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  writeFile: (p, content) => ipcRenderer.invoke('fs:writeFile', { path: p, content }),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),

  // file management
  createFile: (dir, name) => ipcRenderer.invoke('fs:createFile', { dir, name }),
  createDir: (dir, name) => ipcRenderer.invoke('fs:createDir', { dir, name }),
  rename: (path, newName) => ipcRenderer.invoke('fs:rename', { path, newName }),
  deletePath: (p) => ipcRenderer.invoke('fs:delete', p),

  // settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // export
  exportSnapshot: (rect) => ipcRenderer.invoke('export:snapshot', { rect }),
  exportSaveAs: (opts) => ipcRenderer.invoke('export:saveAs', opts),

  // tooling + execution
  detectToolchains: () => ipcRenderer.invoke('toolchains:detect'),
  runFile: (id, file) => ipcRenderer.invoke('run:file', { id, file }),

  // terminal (PTY)
  ptyStart: (opts) => ipcRenderer.invoke('pty:start', opts),
  ptyWrite: (id, data) => ipcRenderer.invoke('pty:write', { id, data }),
  ptyResize: (id, cols, rows) => ipcRenderer.invoke('pty:resize', { id, cols, rows }),
  ptyKill: (id) => ipcRenderer.invoke('pty:kill', id),
  onPtyData: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('pty:data', handler)
    return () => ipcRenderer.removeListener('pty:data', handler)
  },
  onPtyExit: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('pty:exit', handler)
    return () => ipcRenderer.removeListener('pty:exit', handler)
  },

  // native application menu → renderer actions
  onMenuAction: (cb) => {
    const handler = (_e, action) => cb(action)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

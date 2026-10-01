(function (global) {
  'use strict';
  const capacitor = global.Capacitor;
  if (!capacitor || typeof capacitor.getPlatform !== 'function' || capacitor.getPlatform() !== 'android' ||
      (typeof capacitor.isNativePlatform === 'function' && !capacitor.isNativePlatform())) return;

  const plugin = capacitor.Plugins && capacitor.Plugins.FamilyArchive ||
    (typeof capacitor.registerPlugin === 'function' ? capacitor.registerPlugin('FamilyArchive') : null);
  if (!plugin) return;

  let rootUri = null;
  const ready = Promise.resolve().then(() => plugin.getRootUri()).then(result => {
    if (!result || typeof result.rootUri !== 'string' || !result.rootUri.startsWith('file:///')) {
      throw new Error('Android archive directory is unavailable');
    }
    rootUri = result.rootUri.replace(/\/$/, '') + '/';
  });
  // A failed initialization must be surfaced by readArchive/writeArchive, not as an unhandled rejection.
  ready.catch(() => {});

  function validMediaPath(path) {
    if (typeof path !== 'string' || !path.startsWith('media/') || path.length > 1024) return false;
    const parts = path.slice(6).split('/');
    return parts.every(part => /^[\p{L}\p{N} _.,()\-]{1,160}$/u.test(part) &&
      part !== '.' && part !== '..' && !part.startsWith('.'));
  }

  global.FamilyArchiveNative = {
    platform: 'android',
    async readArchive() {
      await ready;
      const result = await plugin.readArchive();
      return result.archive === undefined ? null : result.archive;
    },
    async writeArchive(archive) {
      await ready;
      await plugin.writeArchive({ archive });
    },
    async openMedia(path) {
      await ready;
      if (!validMediaPath(path)) throw new Error("Небезопасный путь документа.");
      return plugin.openMedia({ path });
    },
    async pickMedia() {
      await ready;
      const result = await plugin.pickMedia();
      return result.media || null;
    },
    mediaUrl(path) {
      if (!rootUri || !validMediaPath(path)) return '';
      const uri = rootUri + 'media/' + path.slice(6).split('/').map(encodeURIComponent).join('/');
      return typeof capacitor.convertFileSrc === 'function' ? capacitor.convertFileSrc(uri) : '';
    },
    async openArchive() {
      await ready;
      const result = await plugin.openArchive();
      return result.archive || null;
    },
    async importArchive() {
      await ready;
      const result = await plugin.importArchive();
      return result.archive || null;
    },
    async exportArchive() {
      await ready;
      const result = await plugin.exportArchive();
      return result.status || null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

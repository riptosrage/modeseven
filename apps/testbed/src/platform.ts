/**
 * The small set of things that differ between the browser and the Mac app.
 * Everything else is the same code.
 */

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const isStandalone =
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

const PICKER_TYPES = [{ description: 'Mode 7 project', accept: { 'application/json': ['.mode7.json', '.json'] } }];

type SaveWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
  showOpenFilePicker?: (o: unknown) => Promise<{ getFile(): Promise<File> }[]>;
};

/** Save text to a file the person picks. Returns false if they cancelled. */
export async function saveText(name: string, text: string): Promise<boolean> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: name, filters: [{ name: 'Mode 7 project', extensions: ['json'] }] });
    if (!path) return false;
    await writeTextFile(path, text);
    return true;
  }
  const w = window as SaveWindow;
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: name, types: PICKER_TYPES });
      const s = await h.createWritable();
      await s.write(text);
      await s.close();
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  // Fallback: a plain download (Safari, Firefox).
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** Let the person pick a file and return its text, or null if they cancelled. */
export async function openText(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({ multiple: false, filters: [{ name: 'Mode 7 project', extensions: ['json'] }] });
    return typeof path === 'string' ? readTextFile(path) : null;
  }
  const w = window as SaveWindow;
  if (w.showOpenFilePicker) {
    try {
      const [h] = await w.showOpenFilePicker({ types: PICKER_TYPES });
      return (await h.getFile()).text();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
    }
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
    input.click();
  });
}

/** Ask the browser not to evict saved boards under storage pressure. Harmless where unsupported. */
export async function keepStorage() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not available */
  }
}

/** Offline support for the web build. The Mac app is offline by nature, so it skips this. */
export async function registerOffline() {
  if (isTauri || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch {
    /* offline support is a bonus, never a blocker */
  }
}

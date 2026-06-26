export type DesktopIconName =
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'copy'
  | 'download'
  | 'folder-open'
  | 'maximize'
  | 'minus'
  | 'moon'
  | 'play'
  | 'refresh-cw'
  | 'search-check'
  | 'square'
  | 'sun'
  | 'trash-2'
  | 'upload-cloud'
  | 'x';

const ICON_PATHS: Record<DesktopIconName, string> = {
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  copy: '<path d="M8 7h10"/><path d="M8 12h10"/><path d="M8 17h6"/><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  'folder-open': '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/>',
  minus: '<path d="M5 12h14"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  'refresh-cw': '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  'search-check': '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/><path d="m8.5 11 1.8 1.8 3.7-4"/>',
  square: '<path d="M6 6h12v12H6Z"/>',
  sun: '<path d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/><circle cx="12" cy="12" r="4"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M7 6l1 14h8l1-14"/><path d="M10 10v6"/><path d="M14 10v6"/>',
  'upload-cloud': '<path d="M16 16l-4-4-4 4"/><path d="M12 12v9"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

export function iconSvg(name: DesktopIconName): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" data-icon-name="${name}">${ICON_PATHS[name]}</svg>`;
}

export function isDesktopIconName(value: string | undefined): value is DesktopIconName {
  return typeof value === 'string' && Object.hasOwn(ICON_PATHS, value);
}

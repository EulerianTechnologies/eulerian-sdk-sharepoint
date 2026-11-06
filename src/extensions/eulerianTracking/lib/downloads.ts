/**
 * Document download/open detection.
 *
 * One delegated listener on `document` in the capture phase, so it sees the
 * click before SharePoint's own handlers can stop propagation.
 *
 * What is reliably capturable (an <a href> pointing at a document):
 *  - direct file links            /sites/x/Shared Documents/Report.pdf
 *  - Office for the web links     /_layouts/15/Doc.aspx?sourcedoc={..}&file=Report.docx
 *  - download.aspx links          /_layouts/15/download.aspx?SourceUrl=/sites/x/Docs/a.xlsx
 *  - library preview links        .../AllItems.aspx?id=/sites/x/Shared Documents/a.pdf
 * Known gaps (documented in README): sharing links without a file name
 * (/:w:/g/...), document library rows opened by script (no href on the
 * clicked element), the "Download" command bar button, and previews opened
 * inside SharePoint's file viewer without a link.
 */

export const DOWNLOAD_EXTENSIONS: string[] = [
  'pdf',
  'doc', 'docx', 'docm', 'dot', 'dotx',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'csv',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx',
  'odt', 'ods', 'odp', 'rtf', 'txt',
  'vsd', 'vsdx', 'mpp', 'msg', 'one',
  'zip', '7z', 'rar'
];

// Query parameters SharePoint uses to carry the real file name/path.
const FILE_QUERY_PARAMS: string[] = ['file', 'SourceUrl', 'sourceurl', 'id'];

export interface IDownloadInfo {
  /** Decoded file name, e.g. "Q3 Report.pdf". */
  fileName: string;
  /** Lowercase extension without dot, e.g. "pdf". */
  ext: string;
  /** Absolute href that was clicked. */
  href: string;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Last segment of a path, decoded; "" if none. */
function lastSegment(path: string): string {
  const clean: string = path.split('?')[0].split('#')[0];
  const parts: string[] = clean.split('/');
  for (let i: number = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== '') return safeDecode(parts[i]);
  }
  return '';
}

function fileInfo(candidate: string): { fileName: string; ext: string } | undefined {
  const fileName: string = lastSegment(candidate);
  const dot: number = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return undefined;
  const ext: string = fileName.substring(dot + 1).toLowerCase();
  return DOWNLOAD_EXTENSIONS.indexOf(ext) === -1 ? undefined : { fileName, ext };
}

/** Returns download info if `href` points at a tracked document type. */
export function detectDownload(href: string | undefined, baseUrl: string): IDownloadInfo | undefined {
  if (!href) return undefined;
  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  // Query parameters first: for Doc.aspx/download.aspx the path is the viewer,
  // the real file is in the query.
  for (const param of FILE_QUERY_PARAMS) {
    const value: string | undefined = url.searchParams.get(param) || undefined;
    if (value) {
      const fromQuery: { fileName: string; ext: string } | undefined = fileInfo(value);
      if (fromQuery) return { fileName: fromQuery.fileName, ext: fromQuery.ext, href: url.href };
    }
  }
  const fromPath: { fileName: string; ext: string } | undefined = fileInfo(url.pathname);
  return fromPath ? { fileName: fromPath.fileName, ext: fromPath.ext, href: url.href } : undefined;
}

/** Walks up from the event target to the nearest <a href>. */
export function findAnchor(target: EventTarget | undefined): HTMLAnchorElement | undefined {
  let node: Node | undefined = (target as Node) || undefined;
  // Bounded walk: SharePoint DOMs are deep but a link is never far up.
  for (let depth: number = 0; node && depth < 25; depth++) {
    if (node.nodeType === 1) {
      const el: Element = node as Element;
      if (el.tagName === 'A' && el.getAttribute('href')) return el as HTMLAnchorElement;
    }
    node = node.parentNode || undefined;
  }
  return undefined;
}

export interface IListenerTarget {
  addEventListener(type: string, listener: (event: Event) => void, useCapture: boolean): void;
  removeEventListener(type: string, listener: (event: Event) => void, useCapture: boolean): void;
}

/**
 * Installs the delegated listener. Handles left clicks (`click`, including
 * Ctrl/Shift and keyboard activation) and middle clicks (`auxclick`, which
 * opens in a new tab). Returns a function that removes the listeners.
 */
export function installDownloadListener(
  doc: IListenerTarget,
  getBaseUrl: () => string,
  onDownload: (info: IDownloadInfo) => void,
  onError: (error: unknown) => void
): () => void {
  const handler = (event: Event): void => {
    try {
      if (event.type === 'auxclick' && (event as MouseEvent).button !== 1) return;
      const anchor: HTMLAnchorElement | undefined = findAnchor(event.target || undefined);
      if (!anchor) return;
      const info: IDownloadInfo | undefined = detectDownload(anchor.getAttribute('href') || undefined, getBaseUrl());
      if (info) onDownload(info);
    } catch (error) {
      onError(error);
    }
  };
  doc.addEventListener('click', handler, true);
  doc.addEventListener('auxclick', handler, true);
  return () => {
    doc.removeEventListener('click', handler, true);
    doc.removeEventListener('auxclick', handler, true);
  };
}

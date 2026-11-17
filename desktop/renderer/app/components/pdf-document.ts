import type * as PdfJs from 'pdfjs-dist';

export function loadPdfDocument({ getDocument, GlobalWorkerOptions }: typeof PdfJs, data: Uint8Array) {
  GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', location.href).href;
  return getDocument({
    data,
    useWasm: false,
    wasmUrl: new URL('pdf-decoders/', location.href).href,
    cMapUrl: new URL('pdf-cmaps/', location.href).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('pdf-fonts/', location.href).href,
  });
}

import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

/**
 * Extracts raw text content from uploaded files (.docx, .pdf, .txt, .md)
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const fileExt = file.name.split('.').pop()?.toLowerCase();

  // 1. Plain text / Markdown
  if (fileExt === 'txt' || fileExt === 'md' || fileExt === 'log' || fileExt === 'csv') {
    return await file.text();
  }

  // 2. Word documents (.docx)
  if (fileExt === 'docx') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      if (result.value && result.value.trim().length > 0) {
        return result.value.trim();
      }
    } catch (err) {
      console.warn('Mammoth docx extraction error, trying fallback:', err);
    }
  }

  // 3. PDF documents (.pdf)
  if (fileExt === 'pdf') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(arrayBuffer),
        useSystemFonts: true
      });
      const pdf = await loadingTask.promise;
      let fullText = '';

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageStrings = textContent.items
          .map((item: any) => ('str' in item ? item.str : ''))
          .join(' ');
        fullText += pageStrings + '\n\n';
      }

      if (fullText.trim().length > 0) {
        return fullText.trim();
      }
    } catch (pdfErr) {
      console.warn('PDF.js extraction error, using stream fallback:', pdfErr);
      // Fallback: extract visible text streams from PDF buffer
      const text = await extractFallbackPdfText(file);
      if (text.length > 0) return text;
    }
  }

  // 4. Generic fallback: try reading as text
  try {
    const raw = await file.text();
    const clean = raw.replace(/[^\x20-\x7E\xC0-\xFF\r\n\t]/g, ' ').replace(/\s+/g, ' ');
    if (clean.trim().length > 50) {
      return clean.trim();
    }
  } catch {
    // ignore
  }

  return `Dokument: ${file.name}\n(Größe: ${(file.size / 1024).toFixed(1)} KB)\nInhalt für die Zusammenfassung bereitgestellt.`;
}

async function extractFallbackPdfText(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const str = new TextDecoder('latin1').decode(bytes);
    const matches = str.match(/\(([^()]{3,})\)/g);
    if (matches && matches.length > 0) {
      return matches.map((m) => m.slice(1, -1)).join(' ');
    }
  } catch {
    // ignore
  }
  return '';
}

import { PDFDocument } from "pdf-lib";

/**
 * Postcard dimensions: 4×6 inches at 300 DPI = 1200×1800 px.
 * PDF uses points (72 per inch), so 4×6" = 288×432 pt.
 */
const PAGE_WIDTH_PT = 6 * 72; // 432 pt (landscape: 6" wide)
const PAGE_HEIGHT_PT = 4 * 72; // 288 pt (landscape: 4" tall)

/**
 * Wraps a JPEG postcard image in a print-ready 4×6" PDF.
 * The image is scaled to fill the page exactly (no margins).
 */
export async function buildPrintPdf(jpegBytes: Uint8Array): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	const image = await doc.embedJpg(jpegBytes);

	// The postcard is 1800×1200 (landscape), map to 6×4" page
	const page = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
	page.drawImage(image, {
		x: 0,
		y: 0,
		width: PAGE_WIDTH_PT,
		height: PAGE_HEIGHT_PT,
	});

	return doc.save();
}

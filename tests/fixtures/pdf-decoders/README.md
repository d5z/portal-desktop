# PDF image decoder fixtures

These small, synthetic PDFs are authored for this repository and contain no
third-party document content. Each page is white on the left and black on the
right. The embedded 64 x 64 image uses CCITT Group 4, JBIG2 (an MMR generic
region), or lossless JPEG 2000, respectively.

`generate.py` regenerates the checked-in files using Python and Pillow 12.0.0.
Pillow is only a fixture authoring dependency; the regression test uses the PDF
files directly and needs no Python or external downloads.

`node tests/packaged-resources.mjs` opens all three files through the packaged
application's attachment preview bridge and checks actual canvas pixels. The
app runs from an unrelated temporary working directory. Decoder warnings and
blank images fail the test, even when PDF.js otherwise reports render success.
Screenshots are saved in `test-results/packaged-pdf/`.

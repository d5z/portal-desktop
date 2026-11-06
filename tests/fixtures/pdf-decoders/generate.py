"""Regenerate the synthetic decoder PDFs with Pillow 12.0.0 (not needed by CI)."""
from io import BytesIO
from pathlib import Path
from struct import pack

from PIL import Image

directory = Path(__file__).parent
image = Image.new("1", (64, 64), 1)
image.paste(0, (32, 0, 64, 64))
tiff = BytesIO()
image.save(tiff, format="TIFF", compression="group4")
tiff.seek(0)
encoded = Image.open(tiff)
offset = encoded.tag_v2[273][0]
length = encoded.tag_v2[279][0]
mmr = tiff.getvalue()[offset:offset + length]

# Embedded JBIG2 stream: page information, immediate lossless MMR region,
# and end of page. Each segment has no references and belongs to page 1.
segments = []
for number, (kind, data) in enumerate([
    (48, pack(">IIIIBH", 64, 64, 0, 0, 1, 0)),
    (39, pack(">IIIIBB", 64, 64, 0, 0, 0, 1) + mmr),
    (49, b""),
], 1):
    segments.append(pack(">IBBBI", number, kind, 0, 1, len(data)) + data)

jpx = BytesIO()
image.convert("RGB").save(jpx, format="JPEG2000", irreversible=False)
for name, data, dictionary in [
    ("ccitt", mmr, "/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 64 /Rows 64 /BlackIs1 true >>"),
    ("jbig2", b"".join(segments), "/ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /JBIG2Decode /Decode [1 0]"),
    ("jpeg2000", jpx.getvalue(), "/BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /JPXDecode"),
]:
    content = b"q 200 0 0 200 0 0 cm /Im0 Do Q\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
        f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"endstream",
        f"<< /Type /XObject /Subtype /Image /Width 64 /Height 64 {dictionary} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.5\n")
    offsets = []
    for number, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(b"xref\n0 6\n0000000000 65535 f \n")
    for offset in offsets:
        pdf.extend(f"{offset:010} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    (directory / f"{name}.pdf").write_bytes(pdf)

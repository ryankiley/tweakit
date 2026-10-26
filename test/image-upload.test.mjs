/* What an upload keeps of its file. An animated WebP or APNG is taken as it is, like a GIF, since a redraw keeps only
 * its first frame; the animation is read from chunk headers alone. A picture taken as it is loses its Exif and XMP, GPS
 * and all, losslessly, while its ICC profile and everything else stays byte for byte; a turned photo keeps a bare
 * Orientation. A file with nothing to cut comes back identical. A redraw asks for a Display P3 canvas, so a wide-gamut
 * photo isn't flattened to sRGB. jsdom decodes no images, so the byte helpers are tested bundled from src/, and the
 * control with Image and the canvas context stubbed. Files are built here from bytes. */
import test from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import "./_setup-dom.mjs";
import { bundle } from "./_bundle.mjs";
import { loadSingle, tick } from "./_helpers.mjs";

const { animated, strip } = await bundle("src/tweaks/controls/image.ts");
const { tweaks } = await loadSingle();

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : [...p])));
const u16be = (n) => [n >> 8, n & 255], u32be = (n) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255], u32le = (n) => u32be(n).reverse();
const has = (b, s) => Buffer.from(b).includes(s);

// TIFF, little-endian: IFD0 with an optional Orientation and a GPSInfo pointer; a GPS IFD with GPSLatitudeRef "N".
const tiff = (orient) => {
  const n = orient ? 2 : 1, gps = 8 + 2 + n * 12 + 4, le16 = (v) => [v & 255, v >> 8], le32 = (v) => u32le(v);
  const entries = [...(orient ? [...le16(0x112), ...le16(3), ...le32(1), ...le16(orient), 0, 0] : []), ...le16(0x8825), ...le16(4), ...le32(1), ...le32(gps)];
  return bytes("II", [42, 0], le32(8), le16(n), entries, le32(0), le16(1), le16(1), le16(2), le32(2), "N\0\0\0", le32(0));
};
const seg = (marker, ...body) => { const b = bytes(...body); return bytes([0xff, marker], u16be(b.length + 2), b); };
const SOI = [0xff, 0xd8], JFIF = seg(0xe0, "JFIF\0", [1, 1, 0, 0, 1, 0, 1, 0, 0]), ICC = seg(0xe2, "ICC_PROFILE\0", [1, 1], "Display P3 profile");
const DQT = seg(0xdb, [0], new Array(64).fill(1)), SCAN = bytes(seg(0xda, [1, 1, 0, 0, 63, 0]), [1, 2, 3, 0xff, 0, 4], [0xff, 0xd9]);
const XMP = seg(0xe1, "http://ns.adobe.com/xap/1.0/\0", "<x:xmpmeta><exif:GPSLatitude>37,46.5N</exif:GPSLatitude></x:xmpmeta>");
const jpeg = (...segs) => bytes(SOI, ...segs, DQT, SCAN);

const chunk = (type, ...body) => { const d = bytes(...body), td = bytes(type, d); return bytes(u32be(d.length), td, u32be(crc32(td))); };
const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = chunk("IHDR", u32be(1), u32be(1), [8, 6, 0, 0, 0]), IDAT = chunk("IDAT", [0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1]), IEND = chunk("IEND");
const ICCP = chunk("iCCP", "Display P3\0", [0], [0x78, 0x9c, 1, 2, 3]), NOTE = chunk("tEXt", "Comment\0made by hand");
const png = (...chunks) => bytes(SIG, IHDR, ...chunks, IDAT, IEND);

const riff = (...chunks) => { const body = bytes("WEBP", ...chunks); return bytes("RIFF", u32le(body.length), body); };
const wchunk = (type, ...body) => { const d = bytes(...body); return bytes(type, u32le(d.length), d, d.length & 1 ? [0] : []); };
const VP8X = (flags) => wchunk("VP8X", [flags, 0, 0, 0], [0, 0, 0], [0, 0, 0]);
const ANIM = wchunk("ANIM", [0, 0, 0, 0], [0, 0]), VP8L = wchunk("VP8L", [0x2f, 0, 0, 0, 0]);

const read = async (blob) => new Uint8Array(await blob.arrayBuffer());
const file = (b, type) => new File([b], "x", { type });

test("an animated WebP is known by VP8X's animation bit or an ANIM chunk; a still one isn't", async () => {
  assert.equal(await animated(new Blob([riff(VP8X(0x02), ANIM)])), true, "the flag and the chunk");
  assert.equal(await animated(new Blob([riff(VP8X(0x02))])), true, "the flag alone");
  assert.equal(await animated(new Blob([riff(VP8X(0x20), wchunk("ICCP", "profile"), ANIM)])), true, "an ANIM past an odd-sized ICCP");
  assert.equal(await animated(new Blob([riff(VP8X(0x10), wchunk("ALPH", [1, 2]), VP8L)])), false, "VP8X without animation");
  assert.equal(await animated(new Blob([riff(VP8L)])), false, "a simple lossless WebP");
});

test("an APNG is known by an acTL before its first IDAT; a still PNG, a JPEG or a short file isn't", async () => {
  assert.equal(await animated(new Blob([png(chunk("acTL", u32be(2), u32be(0)))])), true);
  assert.equal(await animated(new Blob([png(ICCP, NOTE)])), false);
  assert.equal(await animated(new Blob([bytes(SIG, IHDR, IDAT, chunk("acTL", u32be(2), u32be(0)), IEND)])), false, "acTL after IDAT is not APNG");
  assert.equal(await animated(new Blob([jpeg(JFIF)])), false);
  assert.equal(await animated(new Blob([bytes("RIFF")])), false);
});

test("animation is read from chunk headers, never the frames", async () => {
  const head = png(ICCP, chunk("acTL", u32be(2), u32be(0))), frames = new Uint8Array(4 << 20), real = new Blob([head, frames]);
  const reads = [];
  const spy = { slice: (a, b) => (reads.push(b - a), real.slice(a, b)), arrayBuffer: () => assert.fail("read the whole file") };
  assert.equal(await animated(spy), true);
  assert.ok(Math.max(...reads) <= 64, `read at most a header at a time: ${reads}`);
});

// The scan gave up after 64 chunks, so an APNG with more ahead of its first frame read as still and was redrawn flat.
test("an acTL past many chunks still marks an APNG, and many chunks with none is still a still PNG", async () => {
  const notes = Array.from({ length: 100 }, (_, k) => chunk("tEXt", `Note${k}\0x`));
  assert.equal(await animated(new Blob([png(...notes, chunk("acTL", u32be(2), u32be(0)))])), true);
  assert.equal(await animated(new Blob([png(...notes)])), false);
});

test("a JPEG loses its Exif (GPS and all) and XMP, and keeps JFIF, its ICC profile and the scan byte for byte", async () => {
  const src = jpeg(JFIF, seg(0xe1, "Exif\0\0", tiff()), ICC, XMP);
  assert.ok(has(src, "Exif") && has(src, "GPSLatitude"));
  const out = await read(await strip(file(src, "image/jpeg")));
  assert.deepEqual(out, jpeg(JFIF, ICC));
});

// Fill bytes before a marker are valid JPEG; read as a parse failure, they kept the file whole, GPS and all.
test("a JPEG with fill bytes before a marker still loses its Exif", async () => {
  const out = await read(await strip(file(bytes(SOI, [0xff, 0xff], seg(0xe1, "Exif\0\0", tiff()), JFIF, DQT, SCAN), "image/jpeg")));
  assert.deepEqual(out, bytes(SOI, [0xff, 0xff], JFIF, DQT, SCAN));
});

// Ultra HDR: the primary's XMP names the gain map (hdrgm:) and its container, and the gain map follows the primary's EOI
// as a second JPEG with an XMP of its own, found through MPF's index of offsets from the MP header.
const NS = 'xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/"';
const gainXmp = (more = "", body = "") => seg(0xe1, "http://ns.adobe.com/xap/1.0/\0", `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta ${NS}${more} x:xmptk="XMP Core 5.5.0"><rdf:RDF><rdf:Description rdf:about="" hdrgm:Version="1.0">${body}<Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="99"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`);
const GAIN_MAP = bytes(SOI, seg(0xe1, "http://ns.adobe.com/xap/1.0/\0", `<x:xmpmeta ${NS}><rdf:RDF><rdf:Description hdrgm:GainMapMax="2.3"/></rdf:RDF></x:xmpmeta>`), DQT, SCAN);
// MPF big-endian: one IFD holding MPEntry, two 16-byte entries; the second image's offset is from the MP header.
const mpIndex = (off) => bytes("MM", [0, 42], u32be(8), [0, 1], [0xb0, 0x02, 0, 7], u32be(32), u32be(26), u32be(0), u32be(0), u32be(0), u32be(0), u32be(0), u32be(0), u32be(GAIN_MAP.length), u32be(off), u32be(0));
const ultraHdr = (before, after) => {
  const build = (off) => bytes(SOI, ...before, seg(0xe2, "MPF\0", mpIndex(off)), ...after, DQT, SCAN, GAIN_MAP);
  const header = 2 + before.reduce((n, s) => n + s.length, 0) + 8;
  return build(build(0).length - GAIN_MAP.length - header);
};
const secondAt = (b) => { const h = Buffer.from(b).indexOf("MPF\0") + 4; return h + new DataView(b.buffer, b.byteOffset).getUint32(h + 26 + 16 + 8); };

test("an Ultra HDR JPEG keeps its gain-map XMP and its gain map, and still loses its Exif", async () => {
  const src = ultraHdr([JFIF, seg(0xe1, "Exif\0\0", tiff()), gainXmp(), ICC], []);
  assert.deepEqual(await read(await strip(file(src, "image/jpeg"))), ultraHdr([JFIF, gainXmp(), ICC], []));
});

test("a gain-map XMP that declares or uses any other namespace is cut like any XMP", async () => {
  for (const xmp of [gainXmp(' xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="37,46.5N"'), gainXmp("", "<exif:GPSLatitude>37,46.5N</exif:GPSLatitude>"), gainXmp(' xmlns:dc="http://purl.org/dc/elements/1.1/"')]) {
    const out = await read(await strip(file(ultraHdr([JFIF, xmp], []), "image/jpeg")));
    assert.ok(!has(out, "GPSLatitude") && !has(out, "xmlns:dc") && !has(out, "hdrgm:Version"), "the primary's XMP is cut");
    assert.ok(has(out, "GainMapMax"), "the gain map is left whole");
  }
});

// A cut between the MP header and the primary's end moved the gain map up, and MPF's offset then pointed past it.
test("a cut after the MPF segment moves the gain map's offset up with it", async () => {
  const src = ultraHdr([JFIF, gainXmp()], [XMP]);
  assert.deepEqual([...src.subarray(secondAt(src), secondAt(src) + 2)], SOI);
  const out = await read(await strip(file(src, "image/jpeg")));
  assert.ok(!has(out, "GPSLatitude"));
  assert.deepEqual([...out.subarray(secondAt(out), secondAt(out) + 2)], SOI, "MPF still finds the gain map");
  assert.deepEqual(out, ultraHdr([JFIF, gainXmp()], []));
});

test("a turned JPEG keeps a bare Exif holding only its Orientation", async () => {
  const out = await read(await strip(file(jpeg(JFIF, seg(0xe1, "Exif\0\0", tiff(6)), ICC), "image/jpeg")));
  const bare = seg(0xe1, "Exif\0\0", "MM", [0, 42], u32be(8), [0, 1], [1, 0x12, 0, 3], u32be(1), [0, 6, 0, 0], u32be(0));
  assert.deepEqual(out, jpeg(JFIF, bare, ICC));
  assert.ok(!has(out, "N\0\0\0"), "no GPS");
});

test("a PNG loses eXIf and XMP text, and keeps iCCP and other text", async () => {
  const xmp = chunk("iTXt", "XML:com.adobe.xmp\0", [0, 0], "\0\0", "<x:xmpmeta>GPS</x:xmpmeta>");
  const raw = chunk("zTXt", "Raw profile type exif\0", [0], [0x78, 0x9c, 1]);
  const out = await read(await strip(file(png(ICCP, chunk("eXIf", tiff()), xmp, NOTE, raw), "image/png")));
  assert.deepEqual(out, png(ICCP, NOTE));
});

test("a turned PNG keeps a bare eXIf with a valid CRC", async () => {
  const out = await read(await strip(file(png(ICCP, chunk("eXIf", tiff(8))), "image/png")));
  assert.deepEqual(out, png(ICCP, chunk("eXIf", "MM", [0, 42], u32be(8), [0, 1], [1, 0x12, 0, 3], u32be(1), [0, 8, 0, 0], u32be(0))));
});

test("a file with nothing to cut, or one that doesn't parse, comes back as it is", async () => {
  for (const [b, type] of [[jpeg(JFIF, ICC), "image/jpeg"], [png(ICCP, NOTE), "image/png"], [riff(VP8X(2), ANIM), "image/webp"],
    [jpeg(seg(0xe1, "Exif\0\0", "II*\0", u32le(9999))), "image/jpeg"], // an IFD offset past the end
    [bytes(SOI, JFIF, seg(0xe1, "Exif\0\0", tiff()).slice(0, 20)), "image/jpeg"], // a truncated segment
    [bytes(SIG, IHDR, chunk("eXIf", tiff()).slice(0, 30)), "image/png"]]) {
    const f = file(b, type);
    assert.equal(await strip(f), f);
  }
});

// The control, through the plain row. jsdom's FileReader reads only jsdom's Blobs, so the kit's new Blob is jsdom's here.
const upload = async (b, type, schema = { type: "image" }) => {
  const p = tweaks("I", { pic: schema }), e = new Event("drop", { bubbles: true, cancelable: true });
  e.dataTransfer = { files: [new window.File([b], "x", { type })] };
  p.el.querySelector(".tw-image .tw-trigger").dispatchEvent(e);
  await tick(30);
  return p.params.pic;
};
const b64 = (b) => Buffer.from(b).toString("base64");
// Each stub is [object, key, value], put back afterwards.
const stubbed = async (stubs, fn) => {
  const was = stubs.map(([o, k]) => o[k]);
  stubs.forEach(([o, k, v]) => (o[k] = v));
  try { return await fn(); } finally { stubs.forEach(([o, k], i) => (o[k] = was[i])); }
};
globalThis.FileReader ??= window.FileReader;

test("an upload taken as it is lands without its GPS; one with nothing to cut lands byte for byte", async () => {
  await stubbed([[globalThis, "Blob", window.Blob]], async () => {
    assert.equal(await upload(jpeg(JFIF, seg(0xe1, "Exif\0\0", tiff()), ICC), "image/jpeg"), "data:image/jpeg;base64," + b64(jpeg(JFIF, ICC)));
    assert.equal(await upload(png(chunk("eXIf", tiff()), NOTE), "image/png"), "data:image/png;base64," + b64(png(NOTE)));
    const plain = jpeg(JFIF, ICC);
    assert.equal(await upload(plain, "image/jpeg"), "data:image/jpeg;base64," + b64(plain));
    assert.equal(await upload(plain, "image/jpeg", { type: "image", fit: false }), "data:image/jpeg;base64," + b64(plain));
  });
});

// Image decodes nothing: each upload that reaches the redraw counts one, and is then taken as it is.
const decodes = (onCanvas) => {
  let n = 0;
  class Img { decode() { n++; return onCanvas ? Promise.resolve() : Promise.reject(new Error("no decode")); } get naturalWidth() { return 4032; } get naturalHeight() { return 3024; } }
  return { count: () => n, stubs: [[globalThis, "Image", Img], [URL, "createObjectURL", () => "blob:x"], [URL, "revokeObjectURL", () => {}]] };
};

test("an animated WebP or APNG upload is taken as it is, never redrawn; a still one goes on to the redraw", async () => {
  const d = decodes(false);
  await stubbed(d.stubs, async () => {
    const webp = riff(VP8X(0x02), ANIM);
    assert.equal(await upload(webp, "image/webp"), "data:image/webp;base64," + b64(webp));
    await upload(png(chunk("acTL", u32be(2), u32be(0))), "image/png");
    assert.equal(d.count(), 0, "neither animated file was decoded for a redraw");
    await upload(riff(VP8L), "image/webp");
    assert.equal(d.count(), 1, "a still WebP is");
  });
});

test("a redraw asks for a Display P3 canvas, and falls back to the plain one where that throws", async () => {
  const d = decodes(true), calls = [];
  const proto = window.HTMLCanvasElement.prototype;
  await stubbed([...d.stubs, [proto, "getContext", (_, o) => { calls.push(o); return null; }]], async () => {
    await upload(jpeg(JFIF), "image/jpeg");
    assert.deepEqual(calls, [{ colorSpace: "display-p3" }, undefined], "P3 first; a null context tries the plain one, as before");
  });
  calls.length = 0;
  await stubbed([...d.stubs, [proto, "getContext", (_, o) => { calls.push(o); if (o) throw new TypeError("colorSpace"); return null; }]], async () => {
    await upload(jpeg(JFIF), "image/jpeg");
    assert.deepEqual(calls, [{ colorSpace: "display-p3" }, undefined]);
  });
});

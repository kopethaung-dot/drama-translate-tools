function toSrtTimestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msRem = ms % 1000;
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msRem, 3)}`;
}

/**
 * segments: [{ start, end, original, translations: { my: "...", en: "..." } }]
 * langCode: "my" | "en" | ... | "original" (uses the transcribed original line)
 */
function segmentsToSrt(segments, langCode) {
  return segments
    .map((seg, i) => {
      const text =
        langCode === "original" ? seg.original : seg.translations[langCode];
      return `${i + 1}\n${toSrtTimestamp(seg.start)} --> ${toSrtTimestamp(
        seg.end
      )}\n${text}\n`;
    })
    .join("\n");
}

module.exports = { segmentsToSrt, toSrtTimestamp };

const ytDlp = require("yt-dlp-exec");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

/**
 * Downloads a video from a TikTok / RedNote (Xiaohongshu) / generic link
 * into a local temp mp4 file and returns its path.
 */
async function downloadFromLink(url) {
  const outPath = path.join(os.tmpdir(), `${uuidv4()}.mp4`);

  await ytDlp(url, {
    output: outPath,
    format: "mp4/best",
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
  });

  return outPath;
}

module.exports = { downloadFromLink };

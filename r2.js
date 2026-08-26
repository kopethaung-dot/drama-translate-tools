const fetch = require("node-fetch");
const fs = require("fs");

/**
 * Uploads a local file to this project's own R2 bucket via this project's
 * own Worker, and returns the public URL. Fully separate from any other
 * project's storage — workerUrl/secret are passed in from this project's
 * own R2_WORKER_UPLOAD_URL / R2_WORKER_SECRET secrets.
 *
 * key: the storage path/filename to give it in the bucket, e.g. "rendered/abc123.mp4"
 */
async function uploadToR2(workerUrl, workerSecret, localFilePath, key, contentType) {
  const fileBuffer = fs.readFileSync(localFilePath);

  const res = await fetch(`${workerUrl}/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "X-Upload-Secret": workerSecret,
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`R2 upload failed (${res.status}): ${errText}`);
  }

  const data = await res.json().catch(() => ({}));
  return data.url || `${workerUrl}/${encodeURIComponent(key)}`;
}

module.exports = { uploadToR2 };

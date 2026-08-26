const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

const { transcribeAndTranslate } = require("./gemini");
const { segmentsToSrt } = require("./srt");
const { downloadFromLink } = require("./download");
const { uploadToR2 } = require("./r2");

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

// Set each of these ONCE with `firebase functions:secrets:set <NAME>` — they
// live in Google Secret Manager and are reused on every future deploy
// automatically. You only ever re-run the command if you want to rotate a
// key. These belong to THIS project only (drama-translate-tools) — nothing
// here is shared with any other project's R2 bucket or Worker.
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const R2_WORKER_UPLOAD_URL = defineSecret("R2_WORKER_UPLOAD_URL");
const R2_WORKER_SECRET = defineSecret("R2_WORKER_SECRET");

// Videos are short (<5 min); generous but bounded limits for the whole pipeline.
setGlobalOptions({ region: "asia-southeast1", memory: "2GiB", timeoutSeconds: 540 });

const LANGUAGE_NAMES = {
  my: "Burmese",
  en: "English",
  zh: "Chinese (Simplified)",
  th: "Thai",
  vi: "Vietnamese",
  ja: "Japanese",
  ko: "Korean",
};

// A Myanmar-supporting Unicode font must ship alongside the function so
// libass can render Burmese glyphs correctly (default fonts show boxes/tofu).
// Place a .ttf (e.g. Padauk-Regular.ttf) in functions/fonts/ before deploying.
const FONTS_DIR = path.join(__dirname, "fonts");

async function runPipeline(geminiApiKey, jobId, localVideoPath, languages) {
  const jobRef = db.collection("jobs").doc(jobId);
  await jobRef.set(
    { status: "transcribing", updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  const targetLanguages = languages.map((code) => ({
    code,
    name: LANGUAGE_NAMES[code] || code,
  }));

  const { segments } = await transcribeAndTranslate(geminiApiKey, localVideoPath, targetLanguages);

  const srt = { original: segmentsToSrt(segments, "original") };
  for (const lang of targetLanguages) {
    srt[lang.code] = segmentsToSrt(segments, lang.code);
  }

  await jobRef.set(
    {
      status: "ready",
      segments,
      srt,
      languages,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Frontend calls this FIRST for a direct file upload:
 * it creates the job doc and tells the frontend exactly where in
 * Firebase Storage to upload the raw video to. The frontend then uploads
 * the file straight to Storage with the client SDK (not through this
 * function) - onVideoUploaded below picks it up automatically.
 */
exports.createUploadJob = onCall(async (request) => {
  const { languages } = request.data;
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new HttpsError("invalid-argument", "languages array is required");
  }

  const jobId = uuidv4();
  const storagePath = `uploads/${jobId}.mp4`;

  await db.collection("jobs").doc(jobId).set({
    status: "awaiting_upload",
    sourceType: "upload",
    storagePath,
    languages,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { jobId, storagePath };
});

/**
 * Frontend calls this for a TikTok / RedNote / other link instead of a file.
 * Runs the whole pipeline inline since the video still needs downloading.
 */
exports.submitLink = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  const { url, languages } = request.data;
  if (!url) throw new HttpsError("invalid-argument", "url is required");
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new HttpsError("invalid-argument", "languages array is required");
  }

  const jobId = uuidv4();
  const storagePath = `uploads/${jobId}.mp4`;

  await db.collection("jobs").doc(jobId).set({
    status: "downloading",
    sourceType: "link",
    sourceUrl: url,
    storagePath,
    languages,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  let localPath;
  try {
    localPath = await downloadFromLink(url);
    await bucket.upload(localPath, { destination: storagePath, metadata: { contentType: "video/mp4" } });
    await runPipeline(GEMINI_API_KEY.value(), jobId, localPath, languages);
  } catch (err) {
    await db.collection("jobs").doc(jobId).set(
      { status: "error", error: String(err.message || err) },
      { merge: true }
    );
    throw new HttpsError("internal", `Failed to process link: ${err.message || err}`);
  } finally {
    if (localPath && fs.existsSync(localPath)) fs.unlinkSync(localPath);
  }

  return { jobId };
});

/**
 * Fires automatically when the frontend finishes uploading the raw video
 * to uploads/{jobId}.mp4 in Storage. Runs transcription + translation.
 */
exports.onVideoUploaded = onObjectFinalized(
  { region: "asia-southeast1", memory: "2GiB", timeoutSeconds: 540, secrets: [GEMINI_API_KEY] },
  async (event) => {
  const filePath = event.data.name; // e.g. uploads/<jobId>.mp4
  const match = filePath.match(/^uploads\/([^/]+)\.mp4$/);
  if (!match) return;
  const jobId = match[1];

  const jobRef = db.collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) return;
  const job = jobSnap.data();
  if (job.sourceType !== "upload") return; // link jobs already run inline

  const localPath = path.join(os.tmpdir(), `${jobId}.mp4`);
  try {
    await bucket.file(filePath).download({ destination: localPath });
    await runPipeline(GEMINI_API_KEY.value(), jobId, localPath, job.languages);
  } catch (err) {
    await jobRef.set({ status: "error", error: String(err.message || err) }, { merge: true });
  } finally {
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  }
  }
);

/**
 * Renders (burns in) subtitles for ONE chosen language on demand, since the
 * user picks the burn-in language per render rather than a fixed default.
 */
exports.renderBurnedVideo = onCall({ secrets: [R2_WORKER_UPLOAD_URL, R2_WORKER_SECRET] }, async (request) => {
  const { jobId, langCode } = request.data;
  if (!jobId || !langCode) throw new HttpsError("invalid-argument", "jobId and langCode are required");

  const jobRef = db.collection("jobs").doc(jobId);
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) throw new HttpsError("not-found", "job not found");
  const job = jobSnap.data();

  if (!job.srt || !job.srt[langCode]) {
    throw new HttpsError("failed-precondition", "subtitles for this language aren't ready yet");
  }

  await jobRef.set(
    { renders: { ...(job.renders || {}), [langCode]: { status: "rendering" } } },
    { merge: true }
  );

  const tmpId = uuidv4();
  const localVideoPath = path.join(os.tmpdir(), `${tmpId}-in.mp4`);
  const localSrtPath = path.join(os.tmpdir(), `${tmpId}.srt`);
  const localOutPath = path.join(os.tmpdir(), `${tmpId}-out.mp4`);

  try {
    await bucket.file(job.storagePath).download({ destination: localVideoPath });
    fs.writeFileSync(localSrtPath, job.srt[langCode], "utf8");

    await new Promise((resolve, reject) => {
      const srtEscaped = localSrtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      const fontsEscaped = FONTS_DIR.replace(/\\/g, "/").replace(/:/g, "\\:");
      ffmpeg(localVideoPath)
        .videoFilters(
          `subtitles='${srtEscaped}':fontsdir='${fontsEscaped}':force_style='FontName=Padauk,FontSize=20,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=40'`
        )
        .outputOptions(["-c:a copy", "-c:v libx264", "-crf 20", "-preset veryfast"])
        .on("end", resolve)
        .on("error", reject)
        .save(localOutPath);
    });

    const key = `rendered/${jobId}-${langCode}.mp4`;
    const url = await uploadToR2(
      R2_WORKER_UPLOAD_URL.value(),
      R2_WORKER_SECRET.value(),
      localOutPath,
      key,
      "video/mp4"
    );

    await jobRef.set(
      { renders: { ...(job.renders || {}), [langCode]: { status: "done", url } } },
      { merge: true }
    );

    return { url };
  } catch (err) {
    await jobRef.set(
      { renders: { ...(job.renders || {}), [langCode]: { status: "error", error: String(err.message || err) } } },
      { merge: true }
    );
    throw new HttpsError("internal", `Render failed: ${err.message || err}`);
  } finally {
    for (const p of [localVideoPath, localSrtPath, localOutPath]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
});

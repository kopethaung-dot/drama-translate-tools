const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const fs = require("fs");

/**
 * Sends a local video file to Gemini and asks it to:
 *  1. Transcribe the spoken audio with accurate start/end timestamps per line.
 *  2. Translate each line into every requested target language, in a natural,
 *     human, context-aware way (not literal word-for-word).
 *
 * apiKey is passed in (from the GEMINI_API_KEY secret) rather than read from
 * process.env directly, so it works cleanly with Firebase's Secret Manager
 * integration for 2nd-gen functions.
 *
 * Returns: { segments: [{ start, end, original, translations: { my: "...", en: "...", ... } }] }
 * start/end are seconds (float), e.g. 12.4
 */
async function transcribeAndTranslate(apiKey, localVideoPath, targetLanguages) {
  const genAI = new GoogleGenerativeAI(apiKey);

  const langList = targetLanguages
    .map((l) => `${l.code} (${l.name})`)
    .join(", ");

  const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      segments: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            start: { type: SchemaType.NUMBER },
            end: { type: SchemaType.NUMBER },
            original: { type: SchemaType.STRING },
            translations: {
              type: SchemaType.OBJECT,
              properties: Object.fromEntries(
                targetLanguages.map((l) => [l.code, { type: SchemaType.STRING }])
              ),
              required: targetLanguages.map((l) => l.code),
            },
          },
          required: ["start", "end", "original", "translations"],
        },
      },
    },
    required: ["segments"],
  };

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const videoBase64 = fs.readFileSync(localVideoPath, { encoding: "base64" });

  const prompt = `You are a professional subtitle translator, not a machine translator.

Watch/listen to this video and produce subtitle segments:
- Split the audio into natural subtitle-length lines (roughly 1-2 short sentences each, matching how a professional subtitler would break lines), each with an accurate start and end time in seconds based on when the speech actually occurs.
- "original" = an accurate transcription of the spoken line, in the language actually spoken in the video.
- "translations" = a natural, fluent, human-quality translation of that line into EACH of these languages: ${langList}.
  - Translate for meaning and natural phrasing the way a skilled human subtitler would, not literally word-for-word.
  - Keep the tone, register, and any humor/emotion of the original.
  - Keep each translated line concise enough to read comfortably as a subtitle.
  - Do not add explanations, notes, or content that wasn't spoken.

Return ONLY the structured JSON matching the schema.`;

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "video/mp4",
        data: videoBase64,
      },
    },
    { text: prompt },
  ]);

  const text = result.response.text();
  const parsed = JSON.parse(text);
  return parsed;
}

module.exports = { transcribeAndTranslate };

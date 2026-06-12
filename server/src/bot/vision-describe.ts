import { chatComplete } from "../llm/client.js";
import type { ChatMessage } from "../llm/client.js";
import { logEvent, logEventError, type EventFields } from "../event-log.js";
import type { ImagePayload } from "./files.js";

/** Enough tokens for dense transcription + scene/object detail. */
const VISION_DESCRIBE_NUM_PREDICT = 768;

const VISION_DESCRIBE_SYSTEM = `You describe images for a Telegram chat bot's memory. Another model reads your text later — anything you omit is lost forever.

Write a thorough plain-text description. No markdown, no preamble ("In this image…"), no bullet syntax.

Extract all visible information that could matter in conversation:
- Image kind (photo, screenshot, meme, sticker artwork, diagram, document scan, etc.)
- People: count, appearance, clothing, pose, expression, actions; approximate age only if obvious
- Objects, products, brands, logos, icons, UI elements, windows, apps, games
- Text: transcribe ALL readable text verbatim (captions, signs, memes, subtitles, watermarks, buttons, errors)
- Numbers: record EVERY visible number exactly as shown — prices, dates, times, scores, stats, counts, percentages, phone/ID/account numbers, measurements, dimensions, version codes, addresses, timers, chart values, table figures
- Setting: place, indoor/outdoor, time of day, weather, background details
- Colors, lighting, art style, composition, mood or emotion the image conveys
- For stickers: characters, scene, symbols, style, implied meaning (use the attached artwork, not emoji alone)

Be exhaustive and factual — describe only what is visible. Note uncertainty when details are ambiguous.
Use multiple short paragraphs or plain labeled lines. Never collapse into one or two sentences.`;

const VISION_DESCRIBE_USER =
  "Describe the attached image in full detail for chat context.";

/** Context-free vision pass — used only to build history text, not the main reply. */
export async function describeVisionImages(
  images: ImagePayload[],
  logContext: EventFields = {},
  visionHint?: string,
  traceTurnId?: number,
): Promise<string> {
  if (images.length === 0) return "";

  logEvent("vision_started", {
    ...logContext,
    imageCount: images.length,
  });

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: VISION_DESCRIBE_SYSTEM },
      {
        role: "user",
        content: [VISION_DESCRIBE_USER, visionHint].filter(Boolean).join("\n\n"),
        images: images.map((i) => i.base64),
      },
    ];

    const raw = await chatComplete(messages, {
      numPredict: VISION_DESCRIBE_NUM_PREDICT,
      auxiliary: true,
      traceTurnId,
      traceLabel: "vision describe",
    });
    const description = raw.trim();
    logEvent("vision_done", {
      ...logContext,
      chars: description.length,
    });
    return description;
  } catch (err) {
    logEventError("vision_failed", err, logContext);
    throw err;
  }
}

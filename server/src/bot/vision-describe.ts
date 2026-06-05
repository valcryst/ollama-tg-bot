import { chatComplete } from "../ollama/client.js";
import type { ChatMessage } from "../ollama/client.js";
import { logEvent, logEventError, type EventFields } from "../event-log.js";
import type { ImagePayload } from "./files.js";

const VISION_DESCRIBE_NUM_PREDICT = 160;

const VISION_DESCRIBE_SYSTEM = `Describe what you see in the image in one or two plain sentences.
Focus only on visible content. No markdown, no labels, no preamble.`;

/** Context-free vision pass — used only to build history text, not the main reply. */
export async function describeVisionImages(
  images: ImagePayload[],
  logContext: EventFields = {},
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
        content: "Describe this image.",
        images: images.map((i) => i.base64),
      },
    ];

    const raw = await chatComplete(messages, {
      numPredict: VISION_DESCRIBE_NUM_PREDICT,
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

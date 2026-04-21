import { generateImagePromptFromDraft } from "./gemini";
import type { StoredSettings } from "./types";

function hashSeed(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash || 1;
}

function buildImageUrl(imagePrompt: string, runDate: string) {
  const seed = hashSeed(`${runDate}|${imagePrompt}`);
  const encodedPrompt = encodeURIComponent(imagePrompt);
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?model=flux&width=1024&height=1024&seed=${seed}&nologo=true`;
}

async function verifyImageUrl(imageUrl: string) {
  const response = await fetch(imageUrl, {
    method: "GET",
    headers: {
      accept: "image/*"
    }
  });

  if (!response.ok) {
    throw new Error(`圖片生成服務回應失敗：${response.status}`);
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("image/")) {
    throw new Error("圖片生成服務未回傳圖片內容");
  }

  if (response.body) {
    void response.body.cancel();
  }
}

export async function generateDraftImageAsset(
  settings: StoredSettings,
  draft: string,
  runDate: string
) {
  const imagePrompt = await generateImagePromptFromDraft(settings, draft, runDate);
  if (!imagePrompt) {
    throw new Error("圖片提示詞為空白");
  }

  const imageUrl = buildImageUrl(imagePrompt, runDate);
  await verifyImageUrl(imageUrl);
  return {
    imageUrl,
    imagePrompt
  };
}

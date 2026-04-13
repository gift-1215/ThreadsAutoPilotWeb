export function validateDraftText(draft) {
  const value = String(draft || "").trim();
  if (!value) {
    return "內容是空白";
  }
  if (value.length >= 500) {
    return `字數過長（${value.length}）`;
  }
  const normalized = value.toLowerCase();
  if (normalized.startsWith("```") || normalized.endsWith("```")) {
    return "請不要輸入 code block 格式";
  }
  if (/\{[\s\S]*\}/.test(value) && value.includes('"')) {
    return "請只輸入貼文內容，不要輸入 JSON";
  }
  return "";
}

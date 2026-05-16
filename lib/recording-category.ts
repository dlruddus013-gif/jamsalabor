export const CALL_RECORDING_CATEGORY = "통화녹음";

const CALL_PATH_PATTERNS = [
  /call/i,
  /tphone/i,
  /phonecall/i,
  /callrecords?/i,
  /recorded\s*call/i,
  /통화/,
  /전화/,
];

const PHONE_NUMBER_PATTERN = /(?:^|[^\d])(?:0\d{1,2}[-_ ]?\d{3,4}[-_ ]?\d{4})(?:[^\d]|$)/;

export function inferRecordingCategory(input: {
  source?: string | null;
  filename?: string | null;
  path?: string | null;
  originalPath?: string | null;
}) {
  const haystack = [input.source, input.filename, input.path, input.originalPath].filter(Boolean).join(" ");
  if (input.source === "phone_backup") return CALL_RECORDING_CATEGORY;
  if (CALL_PATH_PATTERNS.some((pattern) => pattern.test(haystack))) return CALL_RECORDING_CATEGORY;
  if (PHONE_NUMBER_PATTERN.test(haystack)) return CALL_RECORDING_CATEGORY;
  return null;
}

export function mergeRecordingTags(existing: string[] | null | undefined, category: string | null) {
  const tags = new Set(existing ?? []);
  if (category === CALL_RECORDING_CATEGORY) {
    tags.add(CALL_RECORDING_CATEGORY);
    tags.add("백업");
  }
  return Array.from(tags);
}

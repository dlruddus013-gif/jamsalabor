import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { transcribeSignedUrlWithNaver } from "@/lib/integrations/naver-speech";
import { summarizeTranscriptWithLLM } from "@/lib/integrations/llm-summary";
import { maskText } from "@/lib/api/privacy";
import { STORAGE_BUCKET } from "@/lib/upload";
import { CALL_RECORDING_CATEGORY, mergeRecordingTags } from "@/lib/recording-category";

export async function processRecordingNow(recordingId: string) {
  const admin = createSupabaseAdminClient();

  const { data: recording, error } = await admin
    .from("recordings")
    .select("id, audio_path, source, category, tags")
    .eq("id", recordingId)
    .single();

  if (error || !recording?.audio_path) {
    throw new Error(error?.message ?? "recording audio not found");
  }

  await ignoreMissingJobTable(
    admin
    .from("stt_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("recording_id", recordingId)
    .in("status", ["queued", "failed"])
  );

  await admin
    .from("recordings")
    .update({ status: "processing" })
    .eq("id", recordingId)
    .in("status", ["uploading", "processing", "failed"]);

  const { data: signed, error: signedError } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(recording.audio_path, 60 * 30);
  if (signedError || !signed?.signedUrl) {
    throw new Error(signedError?.message ?? "signed url failed");
  }

  const stt = await transcribeSignedUrlWithNaver(signed.signedUrl);
  const segments = stt.segments.length
    ? stt.segments
    : [{ text: stt.text, startSec: 0, endSec: 0, speaker: "0", confidence: null }];

  const { error: deleteSegmentsError } = await admin.from("transcript_segments").delete().eq("recording_id", recordingId);
  if (deleteSegmentsError) throw new Error(`transcript delete failed: ${deleteSegmentsError.message}`);

  const { error: insertSegmentsError } = await admin.from("transcript_segments").insert(
    segments.map((seg) => {
      const startSec = Math.max(0, Math.floor(seg.startSec || 0));
      const endSec = Math.max(startSec, Math.ceil(seg.endSec || startSec));
      return {
        recording_id: recordingId,
        start_sec: startSec,
        end_sec: endSec,
        speaker: seg.speaker === "1" ? "customer" : "agent",
        text: maskText(seg.text),
        text_raw: seg.text,
        confidence: seg.confidence ?? null,
      };
    })
  );
  if (insertSegmentsError) throw new Error(`transcript insert failed: ${insertSegmentsError.message}`);

  const summary = await summarizeTranscriptWithLLM(
    segments.map((seg) => ({
      speaker: seg.speaker === "1" ? "customer" : "agent",
      text: seg.text,
      startSec: seg.startSec,
    }))
  );

  const { error: staleSummaryError } = await admin
    .from("recording_summaries")
    .update({ is_current: false })
    .eq("recording_id", recordingId)
    .eq("is_current", true);
  if (staleSummaryError) throw new Error(`summary rollover failed: ${staleSummaryError.message}`);

  const { error: summaryInsertError } = await admin.from("recording_summaries").insert({
    recording_id: recordingId,
    summary: summary.summary.map(maskText),
    action_items: summary.actionItems.map((item) => ({
      ...item,
      text: maskText(item.text),
    })),
    key_topics: summary.keyTopics,
    sentiment: summary.sentiment,
    model: summary.provider,
    prompt_version: "mobile-auto-v1",
    is_current: true,
    created_by: null,
  });
  if (summaryInsertError) throw new Error(`summary insert failed: ${summaryInsertError.message}`);

  const { error: recordingUpdateError } = await admin
    .from("recordings")
    .update({
      status: "completed",
      sentiment: summary.sentiment,
      tags: mergeRecordingTags(summary.keyTopics, recording.category === CALL_RECORDING_CATEGORY ? CALL_RECORDING_CATEGORY : null),
      excerpt: maskText(stt.text.slice(0, 220)),
      category: recording.category === CALL_RECORDING_CATEGORY ? CALL_RECORDING_CATEGORY : summary.keyTopics[0] ?? null,
    })
    .eq("id", recordingId);
  if (recordingUpdateError) throw new Error(`recording update failed: ${recordingUpdateError.message}`);

  await ignoreMissingJobTable(
    admin
    .from("stt_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    })
    .eq("recording_id", recordingId)
  );

  return {
    recordingId,
    segmentCount: segments.length,
    summaryCount: summary.summary.length,
    provider: summary.provider,
  };
}

async function ignoreMissingJobTable<T>(request: PromiseLike<{ error: T | null }>) {
  const { error } = await request;
  if (!error) return;
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message)
      : String(error);
  if (message.includes("stt_jobs") && (message.includes("schema cache") || message.includes("Could not find the table"))) {
    console.error("[processor] stt_jobs table missing; continuing without job status update:", error);
    return;
  }
  throw new Error(message);
}

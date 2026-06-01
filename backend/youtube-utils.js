const MAX_SOURCE_CHARS = 28000;

function parseYoutubeId(url) {
  const s = String(url || "").trim();
  const m =
    s.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/) ||
    s.match(/^([a-zA-Z0-9_-]{11})$/);
  return m ? m[1] : null;
}

async function fetchYoutubeMeta(videoId) {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await fetch(oembedUrl);
  if (!res.ok) return { title: "YouTube Video", author_name: "" };
  return res.json();
}

async function fetchYoutubeTranscript(videoId) {
  try {
    const { YoutubeTranscript } = require("youtube-transcript");
    const chunks = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    if (chunks?.length) return chunks.map((c) => c.text).join(" ");
    const hi = await YoutubeTranscript.fetchTranscript(videoId, { lang: "hi" });
    if (hi?.length) return hi.map((c) => c.text).join(" ");
  } catch (_) {
    try {
      const { YoutubeTranscript } = require("youtube-transcript");
      const chunks = await YoutubeTranscript.fetchTranscript(videoId);
      if (chunks?.length) return chunks.map((c) => c.text).join(" ");
    } catch (__) {}
  }
  return "";
}

async function extractYoutubeSource(youtubeUrl) {
  const videoId = parseYoutubeId(youtubeUrl);
  if (!videoId) return { error: "Invalid YouTube URL or video ID", status: 400 };

  const [meta, transcript] = await Promise.all([
    fetchYoutubeMeta(videoId),
    fetchYoutubeTranscript(videoId)
  ]);

  const hasTranscript = Boolean(transcript && transcript.length > 50);
  let sourceText = "";
  if (hasTranscript) {
    sourceText = `Video title: ${meta.title}\nChannel: ${meta.author_name || meta.author || ""}\nVideo ID: ${videoId}\n\nTranscript:\n${transcript}`;
  } else {
    sourceText = `Video title: ${meta.title}\nChannel: ${meta.author_name || meta.author || ""}\n\n(No captions/transcript available. Use title and standard syllabus knowledge. Clearly state in summary that transcript was unavailable.)`;
  }

  return {
    sourceType: "youtube",
    sourceRef: youtubeUrl,
    videoId,
    title: meta.title || "YouTube Video",
    channel: meta.author_name || meta.author || "",
    hasTranscript,
    sourceText: sourceText.slice(0, MAX_SOURCE_CHARS)
  };
}

module.exports = {
  parseYoutubeId,
  fetchYoutubeMeta,
  fetchYoutubeTranscript,
  extractYoutubeSource,
  MAX_SOURCE_CHARS
};

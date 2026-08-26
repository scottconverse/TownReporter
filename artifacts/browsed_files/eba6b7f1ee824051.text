"""
YouTube transcript fetcher for Civic Transparency Toolkit.

Fetches recent video metadata from a YouTube channel and retrieves
auto-generated transcripts. Used as an Official Record source when meeting
packets are not yet posted on the city agenda portal.

Dependencies:
    pip install yt-dlp youtube-transcript-api
"""

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Channel video listing (via yt-dlp)
# ---------------------------------------------------------------------------

def _extract_channel_id(url: str) -> str:
    """Normalize a YouTube channel URL into a form yt-dlp can parse."""
    url = url.strip().rstrip("/")
    # Strip tab suffixes like /videos, /streams, /live, /shorts, /playlists
    # so the caller can append /videos cleanly
    import re
    url = re.sub(r"/(videos|streams|live|shorts|playlists|featured|about)$", "", url)
    # Already a valid channel URL — return as-is
    if any(pat in url for pat in ["/channel/", "/@", "/c/", "/user/"]):
        return url
    # Bare channel handle like "YourCityChannel"
    if not url.startswith("http"):
        return f"https://www.youtube.com/@{url}"
    return url


def list_recent_videos(channel_url: str, days: int = 7, max_results: int = 10):
    """
    List recent videos from a YouTube channel.

    Searches BOTH the /videos and /streams tabs because city council
    meetings are typically livestreamed and only appear under /streams.

    Args:
        channel_url: YouTube channel URL or handle
        days: How many days back to look (default 7)
        max_results: Maximum videos to return

    Returns:
        List of dicts: [{video_id, title, upload_date, duration, url}]
    """
    try:
        import yt_dlp
    except ImportError:
        logger.warning("yt-dlp not installed. Run: pip install yt-dlp")
        return []

    channel_url = _extract_channel_id(channel_url)

    cutoff = datetime.now() - timedelta(days=days)
    cutoff_str = cutoff.strftime("%Y%m%d")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "playlistend": max_results * 2,
        "ignoreerrors": True,
        "daterange": yt_dlp.DateRange(start=cutoff_str),
    }

    seen_ids = set()
    videos = []

    # Search both /videos and /streams — council meetings are livestreamed
    # and only appear under /streams, not /videos
    for tab in ("/streams", "/videos"):
        tab_url = channel_url.rstrip("/") + tab
        try:
            logger.info(f"yt-dlp fetching: {tab_url}")
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(tab_url, download=False)
                if not info:
                    logger.warning(f"yt-dlp returned no info for {tab_url}")
                    continue

                entries = info.get("entries", [])
                for entry in entries:
                    if entry is None:
                        continue
                    vid_id = entry.get("id", "")
                    if vid_id in seen_ids:
                        continue
                    seen_ids.add(vid_id)

                    title = entry.get("title", "Untitled")
                    upload_date = entry.get("upload_date", "")
                    duration = entry.get("duration", 0)

                    videos.append({
                        "video_id": vid_id,
                        "title": title,
                        "upload_date": upload_date,
                        "duration": duration,
                        "url": f"https://www.youtube.com/watch?v={vid_id}",
                    })

                    if len(videos) >= max_results:
                        break

        except Exception as e:
            logger.error(f"Error listing {tab} for channel: {e}")

        if len(videos) >= max_results:
            break

    return videos


# ---------------------------------------------------------------------------
# Transcript fetching (via youtube-transcript-api)
# ---------------------------------------------------------------------------

def fetch_transcript(video_id: str, languages: tuple = ("en",)) -> str:
    """
    Fetch the transcript for a single YouTube video.

    Tries manually-created captions first, then falls back to
    auto-generated captions.

    Args:
        video_id: YouTube video ID (e.g., "dQw4w9WgXcQ")
        languages: Language codes to try, in preference order

    Returns:
        Plain-text transcript with timestamps, or empty string on failure.
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        logger.warning(
            "youtube-transcript-api not installed. "
            "Run: pip install youtube-transcript-api"
        )
        return ""

    try:
        # The youtube-transcript-api v1.x uses instance methods
        api = YouTubeTranscriptApi()

        # Try fetching directly — the library handles manual vs auto-generated
        entries = api.fetch(video_id, languages=list(languages))

        lines = []
        for entry in entries:
            # v1.x returns FetchedTranscriptSnippet objects with .text/.start attrs
            start = getattr(entry, "start", None)
            text = getattr(entry, "text", None)
            # Fall back to dict access for older versions
            if start is None:
                start = entry.get("start", 0) if isinstance(entry, dict) else 0
            if text is None:
                text = entry.get("text", "") if isinstance(entry, dict) else ""
            text = str(text).strip()
            if text:
                ts = _format_timestamp(start)
                lines.append(f"[{ts}] {text}")

        logger.info(f"Fetched transcript for {video_id}: {len(lines)} lines")
        return "\n".join(lines)

    except Exception as e:
        logger.error(f"Error fetching transcript for {video_id}: {e}")
        return ""


def _format_timestamp(seconds: float) -> str:
    """Convert seconds to HH:MM:SS or MM:SS format."""
    seconds = int(seconds)
    h, remainder = divmod(seconds, 3600)
    m, s = divmod(remainder, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


# ---------------------------------------------------------------------------
# High-level: fetch transcripts for recent city council meetings
# ---------------------------------------------------------------------------

def fetch_recent_meeting_transcripts(
    channel_url: str,
    days: int = 7,
    max_videos: int = 5,
    keywords: tuple = (
        "council", "meeting", "session", "board", "commission",
        "hearing", "work session", "study session",
    ),
) -> list:
    """
    Fetch transcripts for recent meeting videos from a city YouTube channel.

    Filters videos by title keywords to identify government meeting recordings
    (as opposed to promotional or informational videos).

    Args:
        channel_url: YouTube channel URL or handle
        days: How many days back to search
        max_videos: Maximum number of transcripts to fetch
        keywords: Title keywords that indicate a meeting recording

    Returns:
        List of dicts: [{video_id, title, upload_date, url, transcript}]
    """
    if not channel_url:
        return []

    videos = list_recent_videos(channel_url, days=days, max_results=max_videos * 3)

    logger.info(f"Found {len(videos)} recent videos from channel")
    for v in videos:
        logger.info(f"  Video: {v['title']} ({v['upload_date']}, {v.get('duration', 0)}s)")

    # Filter to likely meeting recordings based on title keywords
    meeting_videos = []
    for v in videos:
        title_lower = v["title"].lower()
        if any(kw in title_lower for kw in keywords):
            meeting_videos.append(v)
        if len(meeting_videos) >= max_videos:
            break

    # If keyword filtering yielded nothing, take the longest videos
    # (meetings tend to be long)
    if not meeting_videos and videos:
        logger.info("No keyword matches — falling back to longest videos")
        sorted_by_duration = sorted(videos, key=lambda x: x.get("duration", 0), reverse=True)
        meeting_videos = sorted_by_duration[:max_videos]

    logger.info(f"Selected {len(meeting_videos)} meeting video(s) for transcript fetch")

    # Fetch transcripts
    results = []
    for v in meeting_videos:
        transcript = fetch_transcript(v["video_id"])
        results.append({
            "video_id": v["video_id"],
            "title": v["title"],
            "upload_date": v["upload_date"],
            "url": v["url"],
            "transcript": transcript,
        })

    return results


def format_transcripts_for_prompt(transcripts: list, max_chars: int = 30000) -> str:
    """
    Format fetched transcripts into a block of text suitable for
    injection into a pipeline prompt's user message.

    Args:
        transcripts: Output from fetch_recent_meeting_transcripts()
        max_chars: Maximum total characters (to stay within token limits)

    Returns:
        Formatted text block, or empty string if no transcripts found.
    """
    if not transcripts:
        return ""

    sections = []
    total_chars = 0

    for t in transcripts:
        if not t.get("transcript"):
            continue

        date_str = t.get("upload_date", "unknown date")
        if len(date_str) == 8:  # YYYYMMDD format
            try:
                dt = datetime.strptime(date_str, "%Y%m%d")
                date_str = dt.strftime("%B %d, %Y")
            except ValueError:
                pass

        header = f"=== MEETING TRANSCRIPT: {t['title']} ({date_str}) ===\n"
        header += f"Source: {t['url']}\n\n"

        transcript_text = t["transcript"]

        # Truncate individual transcript if needed
        remaining = max_chars - total_chars - len(header) - 100
        if remaining <= 0:
            break
        if len(transcript_text) > remaining:
            transcript_text = transcript_text[:remaining] + "\n[... transcript truncated ...]"

        section = header + transcript_text + "\n"
        sections.append(section)
        total_chars += len(section)

    if not sections:
        return ""

    return (
        "\n\n--- YOUTUBE MEETING TRANSCRIPTS (Official Record) ---\n\n"
        + "\n\n".join(sections)
        + "\n--- END TRANSCRIPTS ---\n"
    )

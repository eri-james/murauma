/**
 * GET /api/youtube-feed — Fetch latest videos from YouTube channels (Public)
 *
 * Fetches RSS feeds from 3 YouTube channels, parses them,
 * and returns a combined list sorted by publish date.
 * Results are cached for 10 minutes via Cache-Control header.
 *
 * Channels:
 *   - MURA (Malayan Umamusume Racing Association)
 *   - URA Umamusume Racing Archives
 *   - PakaTube (ぱかチューブっ!【ウマ娘公式】)
 */
import { jsonResponse, errorResponse } from '../_shared/utils.js';

const YOUTUBE_CHANNELS = [
  {
    id: 'UCbqyB2BtAezybU42SCn4kAA',
    name: 'MURA',
    fullName: 'MURA (Malayan Umamusume Racing Association)',
    handle: '@MURAuma',
  },
  {
    id: 'UCZ-pp3o5xhPuwk4RQNQnZHw',
    name: 'URA Archives',
    fullName: 'URA Umamusume Racing Archives',
    handle: '@URAUmaRaceArchives',
  },
  {
    id: 'UCAWxPGGuIfWME2KTLUmSCHw',
    name: 'PakaTube',
    fullName: 'ぱかチューブっ!【ウマ娘公式】',
    handle: '@UMAMUSUME_official',
  },
];

const VIDEOS_PER_CHANNEL = 5;
const RSS_BASE = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

/**
 * Parses a YouTube RSS XML feed and extracts video entries.
 */
function parseRss(xml, channelInfo) {
  const videos = [];
  // Match <entry> blocks
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch;

  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const entry = entryMatch[1];

    // Extract video ID
    const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!videoIdMatch) continue;
    const videoId = videoIdMatch[1];

    // Extract title
    const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1] : 'Untitled';

    // Extract publish date
    const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
    const published = publishedMatch ? publishedMatch[1] : '';

    // Extract thumbnail (use mqdefault for better quality than default, smaller than hq)
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

    // Extract description (first 150 chars)
    const descMatch = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);
    const description = descMatch ? descMatch[1].trim().substring(0, 150) : '';

    videos.push({
      videoId,
      title,
      published,
      thumbnail,
      description,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      channel: {
        name: channelInfo.name,
        handle: channelInfo.handle,
        url: `https://www.youtube.com/${channelInfo.handle}`,
      },
    });
  }

  return videos;
}

export async function onRequestGet(context) {
  try {
    // Fetch all 3 RSS feeds in parallel
    const fetchPromises = YOUTUBE_CHANNELS.map(async (channel) => {
      try {
        const response = await fetch(`${RSS_BASE}${channel.id}`, {
          headers: { 'User-Agent': 'MURA-Feed-Bot/1.0' },
          cf: { cacheTtl: 600 }, // Cache at Cloudflare edge for 10 min
        });

        if (!response.ok) return [];

        const xml = await response.text();
        const videos = parseRss(xml, channel);
        return videos.slice(0, VIDEOS_PER_CHANNEL);
      } catch (err) {
        console.error(`YouTube RSS fetch error for ${channel.name}:`, err.message);
        return [];
      }
    });

    const results = await Promise.allSettled(fetchPromises);

    // Combine all videos
    let allVideos = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        allVideos = allVideos.concat(result.value);
      }
    }

    // Sort by published date (newest first)
    allVideos.sort((a, b) => new Date(b.published) - new Date(a.published));

    return jsonResponse({
      result: 'success',
      channels: YOUTUBE_CHANNELS.map(c => ({
        name: c.name,
        fullName: c.fullName,
        handle: c.handle,
        url: `https://www.youtube.com/${c.handle}`,
      })),
      videos: allVideos,
    }, 200, {
      'Cache-Control': 'public, max-age=600', // Browser cache 10 min
    });
  } catch (error) {
    console.error('YouTube feed error:', error.message);
    return errorResponse('Failed to load YouTube feed.', 500);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1MB request body limit — uploadFullInterviewRecording
    // (the interview's merged audio/video recording, sent as one multipart blob) blows
    // past that almost immediately for anything beyond a few seconds of audio, let alone
    // video. Every recording upload was failing with a generic "unexpected response from
    // the server" — the request never even reached the action's own code, Next.js was
    // rejecting the oversized body first. Raised to match the Appwrite recordings bucket's
    // own 25MB cap, so that limit (which returns a clear, specific error) is what actually
    // gates upload size instead of this one.
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;

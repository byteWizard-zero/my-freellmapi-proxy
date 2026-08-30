import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { AudioRouter } from '../../services/audio-router.js';

async function sendRequest(app: Express, method: string, path: string, body?: any, isFormData = false) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  try {
    const headers: Record<string, string> = {};
    if (!isFormData && body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers: isFormData ? undefined : headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
    });

    const contentType = res.headers.get('content-type') || '';
    let data: any = null;
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else if (contentType.includes('text/plain')) {
      data = await res.text().catch(() => '');
    } else {
      data = Buffer.from(await res.arrayBuffer());
    }

    const resHeaders = Object.fromEntries(res.headers.entries());
    return { status: res.status, body: data, headers: resHeaders };
  } finally {
    server.close();
  }
}

describe('Audio API (/v1/audio/*)', () => {
  let app: Express;

  beforeEach(() => {
    initDb(':memory:');
    app = createApp();
  });

  it('rejects transcription requests with no audio file', async () => {
    const { status, body } = await sendRequest(app, 'POST', '/v1/audio/transcriptions', {});

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('transcribes audio via multipart form upload', async () => {
    vi.spyOn(AudioRouter, 'transcribeAudio').mockResolvedValueOnce({
      text: 'Hello world, this is a test audio recording.',
      task: 'transcribe',
      _routed_via: { platform: 'groq', model: 'whisper-large-v3' },
    });

    const formData = new FormData();
    const blob = new Blob(['FAKE_AUDIO_DATA_FOR_TEST'], { type: 'audio/mp3' });
    formData.append('file', blob, 'sample.mp3');
    formData.append('model', 'whisper-large-v3');

    const { status, body, headers } = await sendRequest(app, 'POST', '/v1/audio/transcriptions', formData, true);

    expect(status).toBe(200);
    expect(body.text).toBe('Hello world, this is a test audio recording.');
    expect(headers['x-routed-via']).toBe('groq/whisper-large-v3');
  });

  it('translates audio to English text', async () => {
    vi.spyOn(AudioRouter, 'translateAudio').mockResolvedValueOnce({
      text: 'Hello, how are you?',
      _routed_via: { platform: 'groq', model: 'whisper-large-v3' },
    });

    const formData = new FormData();
    const blob = new Blob(['FAKE_FRENCH_AUDIO'], { type: 'audio/mp3' });
    formData.append('file', blob, 'french.mp3');
    formData.append('model', 'whisper-large-v3');

    const { status, body } = await sendRequest(app, 'POST', '/v1/audio/translations', formData, true);

    expect(status).toBe(200);
    expect(body.text).toBe('Hello, how are you?');
  });

  it('generates speech and streams audio binary', async () => {
    const fakeAudioBuffer = Buffer.from('MOCK_SPEECH_MP3_STREAM_BINARY');
    vi.spyOn(AudioRouter, 'generateSpeech').mockResolvedValueOnce({
      audioBuffer: fakeAudioBuffer,
      contentType: 'audio/mpeg',
    });

    const { status, body, headers } = await sendRequest(app, 'POST', '/v1/audio/speech', {
      model: 'tts-1',
      input: 'Hello from FreeLLMAPI speech synthesis!',
      voice: 'alloy',
      response_format: 'mp3',
    });

    expect(status).toBe(200);
    expect(headers['content-type']).toContain('audio/mpeg');
    expect(body).toBeDefined();
  });
});

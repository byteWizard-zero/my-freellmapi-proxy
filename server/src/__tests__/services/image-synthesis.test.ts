import { describe, it, expect } from 'vitest';
import { ImageSynthesisService } from '../../services/image-synthesis-service.js';
import type { ChatMessage } from '@freellmapi/shared/types.js';

describe('ImageSynthesisService', () => {
  it('detects image-to-image styling intent with attached image', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'convert it to ghibli' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' } },
        ],
      },
    ];

    const intent = ImageSynthesisService.detectIntent(messages);
    expect(intent).not.toBeNull();
    expect(intent?.isImageIntent).toBe(true);
    expect(intent?.isImageToImage).toBe(true);
    expect(intent?.styleDescription?.toLowerCase()).toContain('ghibli');
    expect(intent?.targetPrompt.toLowerCase()).toContain('studio ghibli');
  });

  it('detects "make it anime style" with attached image', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'make it anime style' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' } },
        ],
      },
    ];

    const intent = ImageSynthesisService.detectIntent(messages);
    expect(intent).not.toBeNull();
    expect(intent?.isImageToImage).toBe(true);
    expect(intent?.targetPrompt.toLowerCase()).toContain('anime');
  });

  it('detects pure text-to-image intent without attached image', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'generate an image of a neon cybernetic tiger walking in rainy Tokyo',
      },
    ];

    const intent = ImageSynthesisService.detectIntent(messages);
    expect(intent).not.toBeNull();
    expect(intent?.isImageIntent).toBe(true);
    expect(intent?.isImageToImage).toBe(false);
    expect(intent?.targetPrompt).toContain('neon cybernetic tiger');
  });

  it('returns null for normal conversational questions', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: 'What is the capital of France?',
      },
    ];

    const intent = ImageSynthesisService.detectIntent(messages);
    expect(intent).toBeNull();
  });
});

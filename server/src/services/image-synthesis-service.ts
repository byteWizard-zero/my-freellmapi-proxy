import { ImageRouter } from './image-router.js';
import type { ChatMessage, ChatCompletionResponse } from '@freellmapi/shared/types.js';

export interface ImageSynthesisIntent {
  isImageIntent: boolean;
  isImageToImage: boolean;
  userText: string;
  imageUrl?: string;
  targetPrompt: string;
  styleDescription?: string;
}

const IMAGE_TRANSFORM_REGEX = /^(?:please\s+)?(?:convert|turn|make|transform|re-?draw|re-?render|change|style|illustrate|render|draw|paint)\s+(?:it|this|the\s+image|the\s+photo|him|her|them)?\s*(?:in(?:to)?|as|to|with)?\s*(.+)$/i;

const TEXT_TO_IMAGE_REGEX = /^(?:please\s+)?(?:generate|create|draw|paint|make|render|produce)\s+(?:an?\s+)?(?:image|picture|photo|illustration|art|painting|drawing)\s+(?:of|showing|depicting|with)?\s*(.+)$/i;

const STYLE_KEYWORDS: Record<string, string> = {
  ghibli: 'authentic Studio Ghibli anime aesthetic, Hayao Miyazaki hand-drawn art, lush watercolor background, soft sunlight, highly detailed anime masterpiece',
  anime: 'vibrant Japanese anime style, clean line art, expressive eyes, cel shaded, trending on Pixiv, Makoto Shinkai lighting',
  cyberpunk: 'futuristic cyberpunk aesthetic, neon glow, holographic reflections, moody volumetric lighting, detailed synthwave atmosphere',
  pixar: 'Pixar 3D animation style, Disney 3D character render, Unreal Engine 5 render, soft subsurface scattering, vibrant warm studio lighting',
  cartoon: 'vibrant 2D modern cartoon illustration, expressive bold outlines, colorful whimsical style',
  watercolor: 'delicate watercolor painting, loose brush strokes, soft pastel paper texture, fluid washes, artistic masterpiece',
  oil: 'classic textured oil painting on canvas, visible rich impasto brushstrokes, dramatic Rembrandt chiaroscuro lighting',
  sketch: 'intricate graphite pencil sketch on aged paper, fine crosshatching, hand-drawn architectural shading',
  photoreal: 'award-winning 8k photorealistic portrait, 85mm f/1.4 lens bokeh, natural soft studio lighting, ultra sharp details',
  retro: 'retro 80s vintage synthwave aesthetic, CRT scanlines, neon magenta and cyan palette',
  comic: 'vintage Marvel/DC comic book art, retro halftones, bold dynamic ink outlines, dramatic shadows',
};

export class ImageSynthesisService {
  /**
   * Detects if the user's latest message indicates an image generation or styling/transformation intent.
   */
  static detectIntent(messages: ChatMessage[]): ImageSynthesisIntent | null {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return null;

    let userText = '';
    let imageUrl: string | undefined;

    if (typeof lastUserMsg.content === 'string') {
      userText = lastUserMsg.content.trim();
    } else if (Array.isArray(lastUserMsg.content)) {
      for (const part of lastUserMsg.content) {
        if (part.type === 'text' && typeof part.text === 'string') {
          userText += ' ' + part.text;
        } else if (part.type === 'image_url' && part.image_url?.url) {
          imageUrl = part.image_url.url;
        }
      }
      userText = userText.trim();
    }

    // 1. Attached image + transformation intent
    if (imageUrl) {
      const transformMatch = userText.match(IMAGE_TRANSFORM_REGEX);
      if (transformMatch || userText.length < 50) {
        let styleTarget = transformMatch ? transformMatch[1].trim() : userText;
        if (!styleTarget || styleTarget.length === 0) {
          styleTarget = 'anime ghibli style';
        }

        // Check if matching known style keyword
        let styleEnhancer = styleTarget;
        const lower = styleTarget.toLowerCase();
        for (const [kw, enhancer] of Object.entries(STYLE_KEYWORDS)) {
          if (lower.includes(kw)) {
            styleEnhancer = `${styleTarget}, ${enhancer}`;
            break;
          }
        }

        return {
          isImageIntent: true,
          isImageToImage: true,
          userText,
          imageUrl,
          targetPrompt: `A detailed portrait/scene of the subject in ${styleEnhancer}, masterpiece quality, rich colors, intricate details`,
          styleDescription: styleTarget,
        };
      }
    }

    // 2. Pure text-to-image intent (e.g. "generate an image of a cat in space")
    const textToImageMatch = userText.match(TEXT_TO_IMAGE_REGEX);
    if (textToImageMatch) {
      const prompt = textToImageMatch[1].trim();
      return {
        isImageIntent: true,
        isImageToImage: false,
        userText,
        targetPrompt: `${prompt}, highly detailed, masterpiece, 8k resolution`,
        styleDescription: prompt,
      };
    }

    return null;
  }

  /**
   * Executes image generation/transformation and returns an OpenAI-compatible ChatCompletionResponse.
   */
  static async executeSynthesis(
    intent: ImageSynthesisIntent,
    modelId = 'flux',
  ): Promise<ChatCompletionResponse> {
    const prompt = intent.targetPrompt;

    const imgResponse = await ImageRouter.generateImage({
      prompt,
      model: modelId,
      response_format: 'b64_json',
      size: '1024x1024',
    });

    const b64 = imgResponse.data?.[0]?.b64_json;
    const url = imgResponse.data?.[0]?.url;
    const imageSrc = b64 ? `data:image/jpeg;base64,${b64}` : (url || '');

    const styleName = intent.styleDescription || 'requested';
    const introText = intent.isImageToImage
      ? `Here is your image transformed into **${styleName}** style:\n\n![Generated Image](${imageSrc})`
      : `Here is your generated image for **"${intent.styleDescription}"**:\n\n![Generated Image](${imageSrc})`;

    return {
      id: `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: imgResponse._routed_via ? `${imgResponse._routed_via.platform}/${imgResponse._routed_via.model}` : 'flux',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: introText,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: Math.ceil(prompt.length / 4),
        completion_tokens: 50,
        total_tokens: Math.ceil(prompt.length / 4) + 50,
      },
      _routed_via: imgResponse._routed_via || {
        platform: 'pollinations',
        model: 'flux',
      },
    };
  }
}

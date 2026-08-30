import { ImageRouter } from './image-router.js';
import { routeRequest } from './router.js';
import type { ChatMessage, ChatCompletionResponse } from '@freellmapi/shared/types.js';

export interface ImageSynthesisIntent {
  isImageIntent: boolean;
  isImageToImage: boolean;
  userText: string;
  imageUrl?: string;
  targetPrompt: string;
  styleDescription?: string;
}

/**
 * ImageSynthesisService — LLM-powered intent detection and prompt crafting.
 *
 * Instead of brittle regex/keyword matching, this service uses the existing
 * LLM routing infrastructure to classify whether the user wants an image
 * generated or transformed, and to produce a rich image-generation prompt.
 *
 * The flow:
 *   1. Quick heuristic pre-filter (does the message mention anything visual
 *      at all?) to avoid burning an LLM call on obvious non-image messages.
 *   2. A lightweight LLM call with a structured JSON schema response to
 *      classify intent and craft the prompt.
 *   3. If the LLM says "yes, this is an image request", we return the intent
 *      object so the proxy can execute image generation.
 */
export class ImageSynthesisService {

  // ─── Quick Heuristic Pre-filter ────────────────────────────────────
  // Cheap string check to avoid an LLM round-trip for obviously non-visual
  // messages like "what's the weather?" or "explain quantum physics".
  // This is intentionally broad — false positives are fine (the LLM will
  // reject them), false negatives are bad (we'd miss real requests).
  private static readonly VISUAL_HINT_PATTERN = /\b(image|picture|photo|illustration|art|painting|drawing|render|sketch|portrait|poster|logo|icon|wallpaper|meme|avatar|banner|thumbnail|visual|anime|ghibli|cartoon|comic|cyberpunk|pixar|watercolor|oil\s*paint|3d|realistic|styliz|convert|transform|turn\s+(it|this|him|her|them)|make\s+(it|this|him|her|them)|re-?draw|re-?style|re-?imagine|generate|create|draw|paint|design|depict)\b/i;

  /**
   * Detects if the user's latest message indicates an image generation or
   * styling/transformation intent. Returns null for non-image messages.
   *
   * This is the static synchronous entry point used by the proxy. It does
   * a quick heuristic check and extracts the user text and any attached
   * image URL. The actual LLM classification happens in classifyWithLLM().
   */
  static extractUserContent(messages: ChatMessage[]): { userText: string; imageUrl?: string } | null {
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

    if (!userText) return null;
    return { userText, imageUrl };
  }

  /**
   * Quick heuristic: does this message look like it *could* be about images?
   * Intentionally broad to minimize false negatives.
   */
  static mightBeImageRequest(userText: string, hasImage: boolean): boolean {
    // If the user attached an image and the text is short, it's likely a
    // styling/transformation request (e.g., "convert it to ghibli").
    if (hasImage && userText.length < 120) return true;

    return this.VISUAL_HINT_PATTERN.test(userText);
  }

  /**
   * Uses a lightweight LLM call to classify whether the user's message
   * is an image generation/transformation request, and if so, produces
   * a rich image-generation prompt.
   *
   * Returns null if the LLM determines this is not an image request.
   */
  static async classifyWithLLM(
    userText: string,
    hasAttachedImage: boolean,
  ): Promise<{ isImage: boolean; prompt: string; style: string } | null> {
    const systemPrompt = `You are an intent classifier for a chat API. Your ONLY job is to determine if the user wants to GENERATE or TRANSFORM an image, and if so, produce a rich prompt for an image generation model (like Stable Diffusion or Flux).

RESPOND WITH VALID JSON ONLY. No markdown, no explanation, no code fences.

Schema:
{
  "is_image_request": boolean,
  "image_prompt": string,
  "style_label": string
}

Rules:
- "is_image_request": true ONLY if the user is asking to CREATE, GENERATE, DRAW, or TRANSFORM/RESTYLE a visual image.
- "is_image_request": false for questions ABOUT images, requests to DESCRIBE/ANALYZE images, code questions, general knowledge, math, or anything else.
- When true, "image_prompt" must be a detailed, vivid prompt for an image generation model (100-250 words). Include subject, composition, style, lighting, colors, mood, medium, and quality tags. DO NOT include negative prompts.
- "style_label" is a short human-readable label for the requested style (e.g., "Studio Ghibli anime", "cyberpunk neon", "oil painting", "photorealistic portrait"). Empty string if not applicable.
- If the user attached an image and asks to transform/restyle it, treat it as an image-to-image request. Describe what the output should look like in rich detail.
- Be generous in interpreting creative/artistic requests as image requests.
- Be strict in rejecting non-visual requests. "Tell me about Ghibli movies" is NOT an image request. "Make this look like Ghibli" IS.`;

    const userMessage = hasAttachedImage
      ? `[User has attached an image and says]: "${userText}"`
      : `[User says]: "${userText}"`;

    try {
      // Use the existing routing infrastructure to find a fast, cheap model
      const route = routeRequest(500);

      const response = await route.provider.chatCompletion(
        route.apiKey,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        route.modelId,
        {
          temperature: 0.1,
          max_tokens: 400,
          response_format: { type: 'json_object' },
        },
      );

      const rawContent = response.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== 'string') return null;

      // Parse the JSON — handle models that wrap in code fences
      const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);

      if (!parsed.is_image_request) return null;

      return {
        isImage: true,
        prompt: parsed.image_prompt || userText,
        style: parsed.style_label || '',
      };
    } catch (err: any) {
      console.warn('[ImageSynthesis] LLM classification failed, skipping image synthesis:', err.message);
      return null;
    }
  }

  /**
   * Full async pipeline: extract → heuristic pre-filter → LLM classify → return intent.
   *
   * Called from the proxy route handler.
   */
  static async detectIntent(messages: ChatMessage[]): Promise<ImageSynthesisIntent | null> {
    const extracted = this.extractUserContent(messages);
    if (!extracted) return null;

    const { userText, imageUrl } = extracted;
    const hasImage = !!imageUrl;

    // Quick pre-filter: skip the LLM call if there's no visual hint at all
    if (!this.mightBeImageRequest(userText, hasImage)) return null;

    // LLM classification
    const classification = await this.classifyWithLLM(userText, hasImage);
    if (!classification) return null;

    return {
      isImageIntent: true,
      isImageToImage: hasImage,
      userText,
      imageUrl,
      targetPrompt: classification.prompt,
      styleDescription: classification.style || undefined,
    };
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
      : `Here is your generated image for **"${intent.userText}"**:\n\n![Generated Image](${imageSrc})`;

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

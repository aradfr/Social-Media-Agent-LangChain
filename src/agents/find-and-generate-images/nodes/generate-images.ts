import { GoogleGenAI, Part } from "@google/genai";
import {
  getMimeTypeFromUrl,
  imageUrlToBuffer,
  retryWithTimeout,
  sleep,
} from "../../utils.js";
import { FindAndGenerateImagesAnnotation } from "../find-and-generate-images-graph.js";
import {
  embedImageInTemplate,
  uploadImageBufferToSupabase,
} from "../helpers.js";
import { getRoleSettings } from "../../../models/index.js";
import { getActiveProfile } from "../../../profiles/index.js";

/**
 * Build the image prompt from the active profile: its JSON prompt template
 * (brand guidelines, constraints) + one of its style variations + the input.
 */
export function buildImagePrompt(
  report: string,
  post: string,
  variationIndex: number,
): string {
  const { promptTemplate, styleVariations } = getActiveProfile().images;
  const styleVariation =
    styleVariations[variationIndex % styleVariations.length];
  return JSON.stringify(
    {
      ...promptTemplate,
      input: { report, post, style_variation: styleVariation },
    },
    null,
    2,
  );
}

export async function generateImageWithNanoBananaPro(
  report: string,
  post: string,
  imageUrls: string[],
  variationIndex: number = 0,
): Promise<{ data: string; mimeType: string }> {
  // Model name + credentials come from the "imageGen" role (config/models.json).
  const imageGen = getRoleSettings("imageGen");
  const client = (() => {
    if (!imageGen.credentials) {
      throw new Error(`imageGen role has no Google credentials`);
    }

    const credentials = JSON.parse(imageGen.credentials);

    return new GoogleGenAI({
      vertexai: true,
      project: credentials.project_id,
      googleAuthOptions: {
        credentials,
      },
    });
  })();

  const prompt = buildImagePrompt(report, post, variationIndex);

  const contents: (string | Part)[] = [prompt];

  // Add reference images (limit to 2 to avoid token limits)
  const referenceImagesWithOmissions = await Promise.all(
    imageUrls.slice(0, 2).map(async (url) => {
      try {
        const { buffer, contentType } = await imageUrlToBuffer(url);

        if (!contentType.startsWith("image/")) {
          console.warn("Skipping non-image content type", { url, contentType });
          return undefined;
        }

        return {
          inlineData: {
            mimeType: contentType,
            data: buffer.toString("base64"),
          },
        };
      } catch (error) {
        console.warn("Failed to load reference image", { url, error });
        return undefined;
      }
    }),
  );

  const validReferenceImages = referenceImagesWithOmissions.filter(
    (d): d is NonNullable<typeof d> => d !== undefined,
  );

  if (validReferenceImages.length > 0) {
    contents.push(...validReferenceImages);
  }

  const generate = (contentsToUse: typeof contents) =>
    client.models.generateContent({
      model: imageGen.model,
      contents: contentsToUse,
      config: {
        temperature: 1.2 + Math.random() * 0.6,
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
      },
    });

  const retryOpts = { maxRetries: 3, baseDelayMs: 3000, timeoutMs: 120_000 };

  const response = await retryWithTimeout(
    () => generate(contents),
    retryOpts,
  ).catch(async (error) => {
    const msg = error instanceof Error ? error.message : String(error);
    const isImageError =
      msg.includes("image is not valid") || msg.includes("INVALID_ARGUMENT");

    if (contents.length > 1 && isImageError) {
      console.warn("Reference images rejected, retrying text-only");
      return retryWithTimeout(() => generate([prompt]), retryOpts);
    }

    throw error;
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("No image generated");
  }

  const imagePart = parts.find((part) =>
    part.inlineData?.mimeType?.startsWith("image/"),
  );
  if (!imagePart?.inlineData) {
    throw new Error("No image data in response");
  }

  return {
    data: imagePart.inlineData.data as string, // Safe to cast as string as we have checked that the data is base64 encoded.
    mimeType: imagePart.inlineData.mimeType as string, // Safe to cast as string as we have checked that the MIME type is valid.
  };
}

export async function generateImageCandidatesForPost(
  state: typeof FindAndGenerateImagesAnnotation.State,
) {
  const {
    report,
    post,
    imageOptions: imageUrls,
    image_candidates: existingCandidates,
  } = state;

  if (!post) {
    throw new Error("No post content available to generate images");
  }

  const imageResults: { data: string; mimeType: string }[] = [];

  const variationCount = getActiveProfile().images.styleVariations.length;
  for (let index = 0; index < variationCount; index++) {
    try {
      const result = await generateImageWithNanoBananaPro(
        report,
        post,
        imageUrls ?? [],
        index,
      );
      imageResults.push(result);
    } catch (error) {
      console.error("Failed to generate image", { error, index });
    }

    await sleep(500);
  }

  const uploadedUrlsWithOmissions = await Promise.all(
    imageResults.map(async ({ data, mimeType }) => {
      try {
        // Optionally frame the image (profile images.frameTemplate).
        const frame = getActiveProfile().images.frameTemplate;
        const buffer =
          frame === "none"
            ? Buffer.from(data, "base64")
            : await embedImageInTemplate(data, mimeType);
        return await uploadImageBufferToSupabase(
          buffer,
          frame === "none" ? "generated" : `generated-${frame}`,
        );
      } catch (error) {
        console.error("Failed to upload generated image", { error });
        return undefined;
      }
    }),
  );

  const uploadedUrls = uploadedUrlsWithOmissions.filter(
    (url): url is NonNullable<typeof url> => url !== undefined,
  );

  const generatedImages = uploadedUrls.map((url) => ({
    imageUrl: url,
    mimeType: getMimeTypeFromUrl(url),
  }));

  const existingCandidatesArray = Array.isArray(existingCandidates)
    ? existingCandidates
    : [];
  const imageUrlsArray = Array.isArray(imageUrls) ? imageUrls : [];

  const randomGeneratedImage =
    generatedImages[Math.floor(Math.random() * generatedImages.length)];

  return {
    imageOptions: [...uploadedUrls, ...imageUrlsArray],
    image_candidates: [...generatedImages, ...existingCandidatesArray],
    image: randomGeneratedImage,
  };
}

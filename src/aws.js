// Amazon Rekognition: finds every face in a photo so Oracle can blur it before anything is stored.
// Its boxes are added to Gemini's, so a face either one misses still gets blurred.
// Off until AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set
// (and `npm install @aws-sdk/client-rekognition` on the server). Never breaks blurring: on any error it returns null.

export const rekognitionEnabled = () =>
  Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) && process.env.AWS_REKOGNITION !== "0";

let client = null, Detect = null;

// Faces as [ymin, xmin, ymax, xmax] on a 0-1000 scale, the same format as Gemini's boxes.
export async function detectFaces(jpeg) {
  if (!rekognitionEnabled()) return null;
  try {
    if (!client) {
      const m = await import("@aws-sdk/client-rekognition");
      client = new m.RekognitionClient({ region: process.env.AWS_REGION });
      Detect = m.DetectFacesCommand;
    }
    const r = await client.send(new Detect({ Image: { Bytes: jpeg }, Attributes: ["DEFAULT"] }));
    return (r.FaceDetails || []).filter((f) => (f.Confidence ?? 100) >= 60).map(({ BoundingBox: b }) => [
      Math.round(b.Top * 1000), Math.round(b.Left * 1000),
      Math.round((b.Top + b.Height) * 1000), Math.round((b.Left + b.Width) * 1000),
    ]);
  } catch (e) {
    console.error("Rekognition skipped:", e.message);
    return null;
  }
}

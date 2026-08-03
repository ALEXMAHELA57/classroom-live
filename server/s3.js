import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET, S3_ENDPOINT } = process.env;

export const configured = Boolean(S3_BUCKET && S3_REGION && S3_ACCESS_KEY && S3_SECRET);

const client = configured
  ? new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT || undefined,
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET },
      forcePathStyle: true, // required by R2 and most non-AWS S3-compatible providers
      // Newer AWS SDK versions add "flexible checksum" params to every
      // request by default (e.g. x-amz-checksum-mode). R2 doesn't
      // reproduce those the same way S3 does, so the signature it
      // recalculates never matches — presigned URLs come back as
      // SignatureDoesNotMatch. This restores the pre-flexible-checksum
      // behavior, which R2 signs correctly.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  : null;

// Generates a short-lived URL that lets the browser download the object
// directly from R2 — the file goes straight to the user's device, it
// never passes through our server. response-content-disposition forces a
// real "Save As" download instead of the browser trying to play/preview it.
export async function getDownloadUrl(key, downloadFilename) {
  if (!client) throw new Error('Recording storage is not configured');
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${downloadFilename}"`,
  });
  return getSignedUrl(client, command, { expiresIn: 300 }); // 5 minutes
}

// Direct-to-R2 upload for files that arrive as a plain buffer (browser
// self-recordings, not LiveKit egress). Unlike egress recordings, which
// LiveKit writes to R2 itself, these come through our server via
// multer, so we push them to R2 here instead of ever touching the
// local disk — Render's free-tier filesystem is ephemeral and wipes on
// every redeploy/cold-start restart, which was silently losing these.
export async function uploadObject(key, buffer, contentType) {
  if (!client) throw new Error('Recording storage is not configured');
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

// A presigned URL is generated at sign-time without ever checking R2 --
// pointing it at a key that was never actually uploaded (e.g. a
// recording made before the R2 migration, when it still lived on local
// disk) doesn't fail until the browser tries to fetch it, and by then
// it downloads R2's XML "no such key" error AS IF it were the file,
// which shows up to the user as "this video is corrupt" instead of a
// clear "not available" message. Checking existence first lets callers
// return an honest error instead.
export async function objectExists(key) {
  if (!client) return false;
  try {
    await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}
